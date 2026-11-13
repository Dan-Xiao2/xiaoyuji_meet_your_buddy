import SwiftUI

struct ContentView: View {
    @StateObject private var check = AudioCheck()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("方式", selection: $check.mode) {
                        ForEach(AudioMode.allCases) { mode in Text(mode.title).tag(mode) }
                    }
                    .disabled(check.running)
                    Button(check.running ? "停止" : "开始") {
                        if check.running { check.stop() } else { check.start() }
                    }
                } footer: {
                    Text("不戴耳机，手机放桌上，音量调到七成以上。换方式前先停止。")
                }

                Section("小宇") {
                    Button(check.playing ? "让小宇停下" : "小宇说话") {
                        if check.playing { check.stopXiaoyu() } else { check.playXiaoyu() }
                    }
                    .disabled(!check.running)
                    Toggle("安静测试（这段时间不要说话）", isOn: $check.quietTest)
                        .disabled(!check.running)
                }

                Section("现在") {
                    LabeledContent("声音从哪里出来", value: check.route)
                    LabeledContent("系统音量", value: "\(Int(check.volume * 100))%")
                    if !check.details.isEmpty {
                        Text(check.details).font(.footnote).foregroundStyle(.secondary)
                    }
                    LevelRow(title: "小宇的声音", db: check.xiaoyuLevel)
                    LevelRow(title: "麦克风（处理后）", db: check.micLevel, marker: check.threshold)
                    VStack(alignment: .leading) {
                        Text("插话门槛 \(Int(check.threshold)) dB")
                        Slider(value: $check.threshold, in: -60 ... -15, step: 1)
                    }
                }

                Section("结果") {
                    LabeledContent("插话被听到", value: "\(check.bargeIns) 次")
                    LabeledContent("安静时误触发", value: "\(check.falseTriggers) 次")
                    LabeledContent("安静时麦克风最高", value: "\(Int(check.loudestQuiet)) dB")
                    LabeledContent("插话时麦克风最高", value: "\(Int(check.loudestTalking)) dB")
                    Button("复制结果") { check.copyResults() }
                }

                Section {
                    Text(check.message).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("小宇外放测试")
        }
    }
}

// A loudness bar from -80 dB to 0 dB, with an optional mark for the cut-in threshold.
struct LevelRow: View {
    let title: String
    let db: Float
    var marker: Float? = nil

    private func position(_ value: Float) -> CGFloat { CGFloat(min(max((value + 80) / 80, 0), 1)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int(db)) dB").monospacedDigit().foregroundStyle(.secondary)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.2))
                    Capsule().fill(Color.accentColor).frame(width: geometry.size.width * position(db))
                    if let marker {
                        Rectangle().fill(Color.primary).frame(width: 2).offset(x: geometry.size.width * position(marker) - 1)
                    }
                }
            }
            .frame(height: 8)
        }
    }
}
