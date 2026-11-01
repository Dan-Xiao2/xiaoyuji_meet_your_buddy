// Home-network family pilot: serve the formal page over HTTPS to a phone on the same Wi-Fi.
// Phone browsers allow the microphone only on secure pages, so this creates a local-only
// certificate authority (installed once on the test phone) and a server certificate for this
// computer's current LAN address, plus an access code the phone types once to pair.
// Everything lives in .certs/ (git-ignored). Nothing is uploaded; no public tunnel is used.
//
//   npm run pilot:lan            # start (creates certificates/code on first run)
//   npm run pilot:lan -- --check # only create/verify certificates, then exit
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { networkInterfaces, hostname } from 'node:os';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';

const dir = join(process.cwd(), '.certs');
const file = name => join(dir, name);
const port = Number(process.env.PILOT_PORT || 4443);

export function lanAddress(interfaces = networkInterfaces()) {
  const candidates = Object.entries(interfaces).flatMap(([name, list]) => (list || [])
    .filter(item => item.family === 'IPv4' && !item.internal).map(item => ({ name, address: item.address })));
  // Prefer the Wi-Fi/Ethernet interface over VPN or virtual adapters.
  return (candidates.find(item => /^en\d/.test(item.name)) || candidates[0])?.address || null;
}

// No 0/O/1/I/L, so a code read off the screen is easy to type on a phone.
export function accessCode(length = 8) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

const openssl = args => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

function ensureCertificates(ip) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(file('ca.key')) || !existsSync(file('xiaoyuji-local-ca.crt'))) {
    writeFileSync(file('ca.ext'), 'basicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
    openssl(['genrsa', '-out', file('ca.key'), '2048']);
    openssl(['req', '-new', '-key', file('ca.key'), '-subj', '/CN=Xiaoyuji Local Pilot CA', '-out', file('ca.csr')]);
    openssl(['x509', '-req', '-in', file('ca.csr'), '-signkey', file('ca.key'), '-days', '825', '-sha256',
      '-extfile', file('ca.ext'), '-out', file('xiaoyuji-local-ca.crt')]);
    chmodSync(file('ca.key'), 0o600);
  }
  // macOS Bonjour name (what other devices resolve as *.local); hostname() can be a DHCP name.
  let local = hostname().split('.')[0];
  if (process.platform === 'darwin') { try { local = execFileSync('scutil', ['--get', 'LocalHostName']).toString().trim() || local; } catch { /* keep hostname */ } }
  const host = `${local}.local`;
  const san = `IP:${ip},IP:127.0.0.1,DNS:localhost,DNS:${host}`;
  const current = existsSync(file('server.crt')) ? openssl(['x509', '-in', file('server.crt'), '-noout', '-text']) : '';
  if (!current.includes(`IP Address:${ip}`) || !current.includes(`DNS:${host}`)) {
    // Apple requires serverAuth EKU and a validity of at most 825 days for user-trusted CAs.
    writeFileSync(file('server.ext'), `basicConstraints=CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
    openssl(['genrsa', '-out', file('server.key'), '2048']);
    openssl(['req', '-new', '-key', file('server.key'), '-subj', `/CN=${ip}`, '-out', file('server.csr')]);
    openssl(['x509', '-req', '-in', file('server.csr'), '-CA', file('xiaoyuji-local-ca.crt'), '-CAkey', file('ca.key'),
      '-CAserial', file('ca.srl'), '-CAcreateserial', '-days', '397', '-sha256', '-extfile', file('server.ext'), '-out', file('server.crt')]);
    chmodSync(file('server.key'), 0o600);
  }
  if (!existsSync(file('access-code'))) writeFileSync(file('access-code'), accessCode(), { mode: 0o600 });
  return { host, code: readFileSync(file('access-code'), 'utf8').trim() };
}

if (process.argv[1]?.endsWith('run-pilot-lan.mjs')) {
  const ip = lanAddress();
  if (!ip) { console.error('没有找到局域网地址：请先连接 Wi-Fi。'); process.exit(1); }
  const { host, code } = ensureCertificates(ip);
  console.log(`
小宇记家庭测试（局域网）
  手机打开：  https://${ip}:${port}/      （或 https://${host}:${port}/）
  访问码：    ${code}
  手机首次使用前，需安装并信任本机证书：${file('xiaoyuji-local-ca.crt')}
  详细步骤见 docs/pilot-lan-setup.md。按 Ctrl+C 结束。
`);
  if (process.argv.includes('--check')) process.exit(0);
  const child = spawn(process.execPath, ['server/server.mjs'], { stdio: 'inherit', env: { ...process.env,
    HOST: '0.0.0.0', PORT: String(port), HTTPS_CERT: file('server.crt'), HTTPS_KEY: file('server.key'), LAN_ACCESS_CODE: code } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', code => process.exit(code ?? 0));
}
