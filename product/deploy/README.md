# 部署到阿里云服务器

> 方案和为什么这样做见 [docs/deployment-cn.md](../docs/deployment-cn.md)。这里是一步一步的操作。涉及账号、密码、API 密钥的步骤都由你自己完成；脚本不会把密钥发到任何地方。

## 开始前

- 已按 deployment-cn.md 第二节完成：阿里云实名认证，买好北京的轻量应用服务器（Ubuntu 24.04），买好域名并完成实名认证，提交了 ICP 备案。
- **部署的是这台电脑上当前的文件，包括还没提交的改动。** 部署前先提交一个确定的版本，并把 `git rev-parse --short HEAD` 记进试点观察记录（试点手册第五节 `build.commit`）。

## 1. SSH 密钥（这台电脑）

```bash
ssh-keygen -t ed25519 -f ~/.ssh/xiaoyuji -C xiaoyuji-server
```

在阿里云轻量应用服务器控制台 → 远程连接（或“密钥”）里，把 `~/.ssh/xiaoyuji.pub` 的内容加给 root。然后试一下：

```bash
ssh -i ~/.ssh/xiaoyuji root@服务器IP
```

之后的命令里，把 `root@服务器IP` 换成你的地址。为了少打字，可以在 `~/.ssh/config` 里加一段 `Host xiaoyuji`（HostName、User root、IdentityFile ~/.ssh/xiaoyuji），之后都写 `xiaoyuji`。

## 2. 控制台防火墙

在轻量应用服务器控制台的“防火墙”页，确认开放 22、80、443，其他端口不开。

## 3. 初始化服务器（只做一次）

在 `product/` 目录下：

```bash
scp deploy/setup-server.sh deploy/xiaoyuji.service root@服务器IP:/root/
```

```bash
ssh root@服务器IP 'bash /root/setup-server.sh'
```

会安装 Node.js 22 和 Caddy，创建运行小宇记的用户 `xiaoyuji`，开启防火墙（只开 SSH、80、443），装好系统服务。

## 4. 第一次部署和填写 `.env`

```bash
XIAOYUJI_SERVER=root@服务器IP bash deploy/deploy.sh
```

第一次会提示服务器上还没有 `.env`。登录服务器填写：

```bash
ssh root@服务器IP
```

在服务器上：

```bash
cd /opt/xiaoyuji/product && cp deploy/env.production.example .env && node deploy/new-secrets.mjs F1 F2 F3
```

最后一条命令会打出两行：`ACCESS_CODES=…` 和 `SESSION_SECRET=…`。用 `nano .env` 打开，把这两行填进对应位置，再填上你的 `QWEN_API_KEY`。保存后：

```bash
chown root:xiaoyuji .env && chmod 640 .env && systemctl restart xiaoyuji && curl -fsS http://127.0.0.1:4173/healthz
```

看到 `{"ok":true}` 就是启动了。每个家庭只给它自己的那个码（`F1:` 后面的部分），不要在群里发全部的码。

## 5. 备案通过前：用 SSH 隧道在电脑上试

服务器这时还不对外开放网页。在这台电脑上：

```bash
ssh -N -L 4173:127.0.0.1:4173 root@服务器IP
```

保持这个窗口开着，用 Chrome 打开 `http://localhost:4173/`，输入一个家庭码，聊几句。这样测的是服务器到阿里云百炼的整条链路；手机要等第 6 步。

## 6. 备案通过后：打开 HTTPS

1. 在域名解析里加一条 A 记录，指向服务器公网 IP。
2. 在服务器上：

```bash
bash /opt/xiaoyuji/product/deploy/enable-https.sh 你的域名
```

Caddy 会自己申请和续期证书。之后手机直接打开 `https://你的域名/`，输入家庭码。手机**不用**再装证书（局域网测试装过的，按 [pilot-lan-setup.md](../docs/pilot-lan-setup.md) 删除）。

## 日常

| 要做的 | 怎么做 |
|---|---|
| 更新代码 | 提交后运行 `XIAOYUJI_SERVER=root@服务器IP bash deploy/deploy.sh`；家庭不用重新输码 |
| 看是否在运行 | `ssh root@服务器IP 'systemctl status xiaoyuji --no-pager'` |
| 看日志 | `ssh root@服务器IP 'journalctl -u xiaoyuji -n 50 --no-pager'`。只有错误信息和每天的用量数字，没有对话内容 |
| 看每家每天用了多少 | `ssh root@服务器IP 'journalctl -u xiaoyuji --no-pager \| grep 小宇记用量'`（每天零点后、每次重启时各记一行） |
| 停用某一家 | 在 `.env` 的 `ACCESS_CODES` 里删掉那一项，`systemctl restart xiaoyuji`。那一家的手机会回到输码页 |
| 给某一家换码 | 改那一项的码，重启；只有那一家需要重新输码 |
| 让所有家庭重新输码 | 换 `SESSION_SECRET`，重启 |
| 某家用量到上限 | 那一家当天的回答、朗读或识别会失败，零点后恢复；需要时调高 `.env` 里的 `USAGE_DAILY_*` 再重启 |
| 系统更新 | `ssh root@服务器IP 'apt-get update && apt-get -y upgrade'`，每月一次 |

## 不要做的

- 不要把 `.env` 复制回电脑、提交到 git 或发给别人。
- 不要在服务器上开其他端口，不要关掉 `PUBLIC_MODE`。
- 不要打开 Caddy 的访问日志（会记录每个请求的地址和路径）。
- 阿里云账号建议开启多因素认证。
