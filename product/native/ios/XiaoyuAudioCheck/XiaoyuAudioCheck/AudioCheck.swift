import AVFoundation
import SwiftUI
import UIKit

// Step 1 of docs/native-app.md: does Xiaoyu's voice play cleanly on the iPhone speaker, at a usable
// volume, while the microphone stays open to hear the child cut in? Three ways are compared:
// A is the system's call-grade echo cancellation (as FaceTime uses), B the same processing with the
// ordinary session mode, C no processing (expected to hear Xiaoyu herself), D playback only with the
// microphone off (a loudness reference, and a check that the sample plays at all). Nothing is
// recorded, saved or sent: the microphone gives a loudness number only.
enum AudioMode: String, CaseIterable, Identifiable {
    case voiceChat = "A"
    case processingOnly = "B"
    case plain = "C"
    case playbackOnly = "D"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .voiceChat: return "A 通话级回声消除"
        case .processingOnly: return "B 回声消除 + 普通模式"
        case .plain: return "C 不消除（对比）"
        case .playbackOnly: return "D 只放不听（音量参照）"
        }
    }
}

enum CheckError: LocalizedError {
    case missingSample
    var errorDescription: String? { "找不到小宇的测试录音" }
}

@MainActor
final class AudioCheck: ObservableObject {
    @Published var mode: AudioMode = .voiceChat
    @Published var threshold: Float = -38
    @Published var quietTest = false {
        didSet {
            if quietTest { quietStartedAt = Date() }
            else if let started = quietStartedAt { quietSeconds += Date().timeIntervalSince(started); quietStartedAt = nil }
        }
    }
    @Published private(set) var running = false
    @Published private(set) var playing = false
    @Published private(set) var micLevel: Float = -100
    @Published private(set) var xiaoyuLevel: Float = -100
    @Published private(set) var route = "—"
    @Published private(set) var volume: Float = 0
    @Published private(set) var bargeIns = 0
    @Published private(set) var falseTriggers = 0
    // The microphone's loudest level while Xiaoyu spoke: in the quiet test (her echo left after
    // processing) and otherwise (someone talking over her). A good threshold lies between the two.
    @Published private(set) var loudestQuiet: Float = -100
    @Published private(set) var loudestTalking: Float = -100
    @Published private(set) var message = "选一种方式，点“开始”。"
    // Engine, player and output format, for finding out why something is silent.
    @Published private(set) var details = ""

    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var sample: AVAudioPCMBuffer?
    private var loudSince: Date?
    private var lastTrigger = Date.distantPast
    private var quietStartedAt: Date?
    private var quietSeconds: TimeInterval = 0
    private var routeObserver: NSObjectProtocol?
    private var configObserver: NSObjectProtocol?

    init() {
        routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
            Task { @MainActor in
                self?.updateRoute()
                AudioCheck.log("route change (reason \(reason)) → \(self?.route ?? "")")
            }
        }
    }

    func start() {
        guard !running else { return }
        if mode == .playbackOnly { startEngine(); return }
        AVAudioApplication.requestRecordPermission { granted in
            Task { @MainActor in
                if granted { self.startEngine() }
                else { self.message = "没有麦克风权限：设置 → 隐私与安全性 → 麦克风，打开“小宇外放测试”。" }
            }
        }
    }

    private func startEngine() {
        do {
            let sample = try self.sample ?? loadSample()
            self.sample = sample
            let session = AVAudioSession.sharedInstance()
            if mode == .playbackOnly {
                try session.setCategory(.playback, mode: .default)
            } else {
                try session.setCategory(.playAndRecord, mode: mode == .voiceChat ? .voiceChat : .default, options: [.defaultToSpeaker])
            }
            try session.setActive(true)

            let engine = AVAudioEngine()
            // Echo cancellation must be switched on before the engine starts; it covers input and output.
            if mode == .voiceChat || mode == .processingOnly { try engine.inputNode.setVoiceProcessingEnabled(true) }
            let player = AVAudioPlayerNode()
            engine.attach(player)
            // Xiaoyu plays through the same engine, so the echo canceller knows what to remove.
            engine.connect(player, to: engine.mainMixerNode, format: sample.format)
            engine.connect(engine.mainMixerNode, to: engine.outputNode, format: nil)
            engine.mainMixerNode.outputVolume = 1
            if mode != .playbackOnly {
                let input = engine.inputNode
                input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buffer, _ in
                    let db = AudioCheck.level(of: buffer)
                    Task { @MainActor in self?.heard(db) }
                }
            }
            engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: engine.mainMixerNode.outputFormat(forBus: 0)) { [weak self] buffer, _ in
                let db = AudioCheck.level(of: buffer)
                Task { @MainActor in self?.xiaoyuLevel = db }
            }
            engine.prepare()
            try engine.start()
            // The system can reconfigure audio (e.g. a route change) and stop the engine: start it
            // again and carry on playing.
            configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.recover() }
            }

            self.engine = engine
            self.player = player
            bargeIns = 0
            falseTriggers = 0
            quietSeconds = 0
            loudestQuiet = -100
            loudestTalking = -100
            running = true
            UIApplication.shared.isIdleTimerDisabled = true
            updateRoute()
            updateDetails()
            AudioCheck.log("started \(mode.rawValue): \(details) route=\(route) volume=\(Int(volume * 100))%")
            message = "已开始。点“小宇说话”。"
        } catch {
            AudioCheck.log("start failed: \(error)")
            message = "没能开始：\(error.localizedDescription)"
            stop()
        }
    }

    private func recover() {
        guard let engine, let player, let sample else { return }
        AudioCheck.log("engine configuration changed; running=\(engine.isRunning)")
        if !engine.isRunning {
            do { try engine.start() } catch { AudioCheck.log("restart failed: \(error)"); message = "声音被系统中断了，请停止后重新开始。" }
        }
        if playing && engine.isRunning && !player.isPlaying {
            player.scheduleBuffer(sample, at: nil, options: .loops)
            player.play()
        }
        updateDetails()
    }

    private func updateDetails() {
        guard let engine, let player else { details = ""; return }
        let output = engine.outputNode.outputFormat(forBus: 0)
        let session = AVAudioSession.sharedInstance()
        details = "引擎\(engine.isRunning ? "运行中" : "已停止") · 播放器\(player.isPlaying ? "在放" : "没在放") · 输出 \(Int(output.sampleRate)) Hz \(output.channelCount) 声道 · \(session.mode.rawValue.replacingOccurrences(of: "AVAudioSessionMode", with: ""))"
    }

    // To the device console (Xcode, or devicectl --console), unbuffered.
    nonisolated static func log(_ text: String) {
        FileHandle.standardError.write(Data("[小宇测试] \(text)\n".utf8))
    }

    func stop() {
        stopXiaoyu()
        quietTest = false
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = nil
        if let engine {
            if mode != .playbackOnly { engine.inputNode.removeTap(onBus: 0) }
            engine.mainMixerNode.removeTap(onBus: 0)
            engine.stop()
        }
        engine = nil
        player = nil
        details = ""
        running = false
        micLevel = -100
        xiaoyuLevel = -100
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func playXiaoyu() {
        guard let engine, let player, let sample else { return }
        // Turning on echo cancellation makes iOS reconfigure audio just after the start, which stops
        // the engine (seen on iOS 27): start it again before playing, or play() would fail.
        if !engine.isRunning {
            do { try engine.start() } catch { AudioCheck.log("start before play failed: \(error)"); message = "声音没能开始，请停止后重新开始。"; return }
        }
        player.stop()
        player.scheduleBuffer(sample, at: nil, options: .loops)
        player.play()
        playing = true
        updateRoute()
        updateDetails()
        AudioCheck.log("play: \(details) route=\(route) volume=\(Int(volume * 100))%")
        loudSince = nil
        lastTrigger = Date() // the first second after starting does not count
        message = mode == .playbackOnly ? "小宇在说话（只放不听，不判断插话）。"
            : quietTest ? "安静测试中：不要说话，看会不会误触发。" : "小宇在说话，随时插话试试。"
    }

    func stopXiaoyu() {
        player?.stop()
        playing = false
    }

    // Loud enough for a quarter of a second while Xiaoyu speaks counts as a cut-in. During the quiet
    // test nobody speaks, so any trigger there is Xiaoyu hearing herself.
    private func heard(_ db: Float) {
        micLevel = db
        guard playing else { loudSince = nil; return }
        if quietTest { loudestQuiet = max(loudestQuiet, db) } else { loudestTalking = max(loudestTalking, db) }
        guard db > threshold else { loudSince = nil; return }
        let now = Date()
        let since = loudSince ?? now
        loudSince = since
        guard now.timeIntervalSince(since) >= 0.25, now.timeIntervalSince(lastTrigger) >= 1 else { return }
        loudSince = nil
        lastTrigger = now
        if quietTest {
            falseTriggers += 1
            message = "安静时也触发了（\(Int(db)) dB）：小宇被自己的声音打断。"
        } else {
            bargeIns += 1
            stopXiaoyu()
            message = "听到你插话，小宇停下了。再点“小宇说话”继续。"
        }
    }

    func copyResults() {
        let quiet = quietSeconds + (quietStartedAt.map { Date().timeIntervalSince($0) } ?? 0)
        let result: [String: Any] = [
            "mode": mode.rawValue, "route": route, "systemVolumePercent": Int(volume * 100), "thresholdDb": Int(threshold),
            "cutInsHeard": bargeIns, "falseTriggers": falseTriggers, "quietTestSeconds": Int(quiet),
            "quietMaxDb": Int(loudestQuiet), "talkingMaxDb": Int(loudestTalking), "ios": UIDevice.current.systemVersion
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return }
        UIPasteboard.general.string = text
        message = "结果已复制，可以粘贴到对话里。"
    }

    private func updateRoute() {
        let session = AVAudioSession.sharedInstance()
        route = session.currentRoute.outputs.map { port -> String in
            switch port.portType {
            case .builtInSpeaker: return "扬声器（外放）"
            case .builtInReceiver: return "听筒"
            case .headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: return "耳机"
            default: return port.portName
            }
        }.joined(separator: "、")
        volume = session.outputVolume
    }

    private func loadSample() throws -> AVAudioPCMBuffer {
        guard let url = Bundle.main.url(forResource: "xiaoyu-sample", withExtension: "wav") else { throw CheckError.missingSample }
        let file = try AVAudioFile(forReading: url)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw CheckError.missingSample
        }
        try file.read(into: buffer)
        return buffer
    }

    // Loudness of the first channel in dBFS (-100 for silence).
    nonisolated static func level(of buffer: AVAudioPCMBuffer) -> Float {
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return -100 }
        let samples = channels[0]
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
        let rms = (sum / Float(buffer.frameLength)).squareRoot()
        return max(-100, 20 * log10(max(rms, 1e-7)))
    }
}
