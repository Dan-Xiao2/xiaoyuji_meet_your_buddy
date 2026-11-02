# GitHub发布检查：模拟模型测试的环境隔离

## 为什么连续收到failed

工作流 `.github/workflows/product-release-check.yml` 在每次main推送后运行发布检查。因此同一个未解决的测试问题，会随后续每次推送重复发送失败通知。推送已经成功，失败的是后续 `npm run check:release`；依赖安装及Chromium安装均通过。

本轮读取最近10次工作流，前5次成功、后5次失败。失败日志如下：

| 提交 | 工作流 | 失败测试 |
|---|---|---|
| d4d47c8 | [41350445939](https://github.com/Dan-Xiao2/xiaoyuji_meet_your_buddy/actions/runs/41350445939) | interrupted-history |
| 66e28e5 | [41361975118](https://github.com/Dan-Xiao2/xiaoyuji_meet_your_buddy/actions/runs/41361975118) | interrupted-history |
| a2947c1 | [41422642553](https://github.com/Dan-Xiao2/xiaoyuji_meet_your_buddy/actions/runs/41422642553) | interrupted-history、reply-style |
| f060cfd | [41432932768](https://github.com/Dan-Xiao2/xiaoyuji_meet_your_buddy/actions/runs/41432932768) | 同上两项 |
| 1d7f3b7 | [41434458620](https://github.com/Dan-Xiao2/xiaoyuji_meet_your_buddy/actions/runs/41434458620) | 同上两项 |

这5次均在Node测试阶段失败，未运行到后续浏览器检查；与此前本机浏览器偶发超时不是同一个失败。

## 根因

CI为避免真实付费调用，设置 `TUTOR_ENABLE_LLM=false`、`USE_CLOUD_TTS=false`、`IMAGE_DRAWING_ENABLED=false`。两个测试只设置了虚构密钥和模拟fetch，没有显式启用被模拟的模型路径。

产品正确遵守关闭开关，走本地回退；模拟fetch没有执行，测试变量body保持undefined。测试随后读取body.messages而失败。没有该环境开关的本机测试可以通过，掩盖了环境依赖。之前的本机验证没有覆盖CI配置，这是验证遗漏，不能由本机通过推断远端通过。

## 最小修复

只修改 `tests/interrupted-history.test.mjs` 和 `tests/reply-style.test.mjs`：

- 在需要捕获模拟请求的测试内显式设置 `TUTOR_ENABLE_LLM=true`、`LLM_PROVIDER=qwen`、虚构密钥和不可用的example.invalid地址。
- fetch仍由本机mock替代，不访问真实服务。产品代码和CI工作流的费用保护保持原样。
- 保存并在t.after恢复四个环境变量，避免泄漏给后续测试。
- 先断言模拟请求确实执行，再检查历史和提示内容；原有内容断言全部保留。

## 验证范围

使用与CI相同的三个关闭开关，改前4项中2项失败，修改后4/4通过。同配置完整 `npm run check:release` 退出0，470项Node检查、业务smoke及17组浏览器流程通过。推送后应以新提交的GitHub Actions结果确认Linux环境通过。没有调用付费模型，没有关闭、跳过测试或放宽断言。
