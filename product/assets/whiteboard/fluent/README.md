# Fluent 白板素材来源

- 上游：https://github.com/microsoft/fluentui-emoji
- 固定版本：`1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`
- 许可：MIT，版权声明及完整条款见同目录 `LICENSE`。
- `rabbit.svg`：上游 `assets/Rabbit/Flat/rabbit_flat.svg`。
- `car.svg`：上游 `assets/Automobile/Flat/automobile_flat.svg`。

这两个源文件保持原样，不是模型临时生成的插画，也不是本项目原创资产。品牌角色“小宇”不受影响。

`python3 scripts/build-whiteboard-assets.py` 使用 XML 解析器检查仅含静态 path、固定填充色和32×32 viewBox，拒绝外链、脚本和未知属性，再生成 `src/whiteboard/compiledAssets.js`。加 `--check` 检查生成结果是否过期。构建需要 Python 3 标准库，运行网页不需要 Python。

运行时改动：统一缩放、定位；小兔第1号路径允许身体改色，汽车第0号路径允许车身改色（从0计数）。耳朵、眼睛、车窗、车轮等保留上游填充，不做任意部件生成。相关映射在 `src/whiteboard/drawingCatalog.js`，更换上游版本后必须重新核对路径索引和截图。

新增素材流程：核对许可及来源 → 固定版本 → 检查可辨识性与可改部件 → XML受限编译 → 登记 catalog → 单元/浏览器像素/撤销/存档测试。不能直接把整套 emoji 自动暴露为已支持绘画能力。
