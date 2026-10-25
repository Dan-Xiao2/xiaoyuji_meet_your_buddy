# Supabase Setup Plan

这份说明是给之后真实接数据库用的。现在不用立刻注册 Supabase，也不影响本地 demo 运行。

## 文件

- `supabase/schema.sql`：核心表结构
- `supabase/seed.sql`：演示数据
- `supabase/policies.sql`：Row Level Security 权限草案
- `supabase/queries.sql`：常用查询
- `supabase/memory_examples.md`：Student Memory 示例

## Supabase 第一版步骤

1. 创建 Supabase project。
2. 打开 SQL Editor。
3. 先执行 `supabase/schema.sql`。
4. 再执行 `supabase/seed.sql`。
5. 本地验证数据没问题后，再执行 `supabase/policies.sql`。
6. 在后端保存这些环境变量：

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

注意：`SERVICE_ROLE_KEY` 只能放后端，不能放浏览器。

## MVP 不建议一开始存的数据

- 真实姓名
- 详细地址
- 学校班级
- 儿童照片
- 家长手机号
- 完整长期录音

第一版建议只存：

- 匿名学生 id
- 昵称
- 年龄段
- 兴趣
- 孩子原话和成长证据
- 表达、探索和支持方式的结构化线索
- 可选的掌握度和误区证据
- 家长确认或补充的观察

## 未来代码替换点

现在本地适配层：

```text
src/data/localStudentDb.js
```

未来可以新增：

```text
src/data/supabaseStudentDb.js
```

然后暴露同样的方法：

```js
loadStudentModel(studentId)
persistStudentModel(studentModel)
appendStudentEvent(studentId, type, payload)
```

这样 Companion Engine 不需要知道底层是 localStorage 还是 Supabase。

## 为什么不让前端直接写所有表

儿童成长数据应该由可信后端写入，尤其是：

- mastery update
- misconception update
- lesson summary
- behavioural metrics
- evidence source and confidence

前端可以提交孩子表达、选择和家长观察，但最终如何更新 Student Model，应该在后端完成。
