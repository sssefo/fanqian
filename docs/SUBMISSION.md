# 饭签参赛交付

状态：公开项目已发布并完成克隆验证；报名尚未完成，等待参赛者本人提交官方 Issue。

公开仓库：https://github.com/lining19920728-hub/fanqian

## 报名

[打开已预填标题和正文的官方报名页面](https://github.com/M-China/mcd-developer-innovation-challenge/issues/new?title=%E3%80%96%E5%8F%82%E8%B5%9B%E7%94%B3%E8%AF%B7%E3%80%97%E9%A5%AD%E7%AD%BE%EF%BC%9A%E6%8A%8A%E4%B8%8B%E4%B8%80%E9%A4%90%E4%BA%A4%E7%BB%99%E4%B8%80%E7%82%B9%E5%A5%BD%E8%BF%90&body=%E3%80%96%E5%8F%82%E8%B5%9B%E7%94%B3%E8%AF%B7%E3%80%97%0A%E9%A1%B9%E7%9B%AE%E5%90%8D%E7%A7%B0%EF%BC%9A%E9%A5%AD%E7%AD%BE%0A%E9%A1%B9%E7%9B%AE%E5%9C%B0%E5%9D%80%EF%BC%9Ahttps%3A%2F%2Fgithub.com%2Flining19920728-hub%2Ffanqian%0A%E9%A1%B9%E7%9B%AE%E7%AE%80%E4%BB%8B%EF%BC%9A%E5%9F%BA%E4%BA%8E%E9%BA%A6%E5%BD%93%E5%8A%B3%20MCP%20%E7%9C%9F%E5%AE%9E%E9%97%A8%E5%BA%97%E8%8F%9C%E5%8D%95%E7%9A%84%E8%B6%A3%E5%91%B3%E6%8A%BD%E9%A4%90%E5%BA%94%E7%94%A8%E3%80%82%E6%94%AF%E6%8C%81%E5%A5%97%E9%A4%90%E3%80%81%E5%B0%8F%E5%90%83%E5%92%8C%E9%A5%AE%E5%93%81%E7%AD%BE%E6%B1%A0%E3%80%81%E9%97%A8%E5%BA%97%E6%90%9C%E7%B4%A2%E3%80%81%E9%BB%98%E8%AE%A4%E6%90%AD%E9%85%8D%E6%9F%A5%E8%AF%A2%E3%80%81%E5%B7%B2%E6%8C%81%E6%9C%89%E5%8D%95%E5%88%B8%E4%B8%8E%E4%B8%8D%E7%94%A8%E5%88%B8%E7%9A%84%E6%A0%B8%E4%BB%B7%E6%AF%94%E8%BE%83%E3%80%81%E7%94%A8%E6%88%B7%E6%98%8E%E7%A1%AE%E7%A1%AE%E8%AE%A4%E5%90%8E%E7%9A%84%E5%88%B0%E5%BA%97%E8%87%AA%E5%8F%96%E4%B8%8B%E5%8D%95%EF%BC%8C%E4%BB%A5%E5%8F%8A%E7%94%A8%E9%A4%90%E8%AE%B0%E5%BD%95%E5%92%8C%E5%91%A8%E6%9C%88%E5%9B%9E%E9%A1%BE%E3%80%82Token%20%E4%BB%85%E7%94%B1%E6%9C%AC%E6%9C%BA%E6%9C%8D%E5%8A%A1%E8%AF%BB%E5%8F%96%EF%BC%8C%E9%80%89%E5%AE%9A%E5%92%8C%E4%B8%8B%E5%8D%95%E4%B8%8D%E4%BC%9A%E8%87%AA%E5%8A%A8%E8%AE%B0%E4%BD%9C%E5%90%83%E8%BF%87%EF%BC%9B%E6%8F%90%E4%BA%A4%E7%BB%93%E6%9E%9C%E4%B8%8D%E6%98%8E%E7%A1%AE%E6%97%B6%E5%81%9C%E6%AD%A2%E9%87%8D%E8%AF%95%EF%BC%8C%E9%81%BF%E5%85%8D%E9%87%8D%E5%A4%8D%E8%AE%A2%E5%8D%95%E3%80%82)，以自己的 GitHub 账号提交。收到官方成功回复后再更新本文件为报名成功。

当前 GitHub 连接可写项目仓库，但在官方活动仓库创建 Issue 返回 `403 Resource not accessible by integration`。未收到创建成功响应或官方报名确认，不能将发布完成理解为报名成功。

```text
〖参赛申请〗
项目名称：饭签
项目地址：https://github.com/lining19920728-hub/fanqian
项目简介：基于麦当劳 MCP 真实门店菜单的趣味抽餐应用。支持套餐、小吃和饮品签池、门店搜索、默认搭配查询、已持有单券与不用券的核价比较、用户明确确认后的到店自取下单，以及用餐记录和周月回顾。Token 仅由本机服务读取，选定和下单不会自动记作吃过；提交结果不明确时停止重试，避免重复订单。
```

建议标题：〖参赛申请〗饭签：把下一餐交给一点好运。

## 发布验证（2026-10-10）

- 已发布源码、README.md、MCP_INTEGRATION.md、mcp-config.example.json、官方原文 CONTEST_DECLARATION.md 和轻量浏览器截图。
- 从公开仓库重新克隆，44项测试通过；在克隆目录用本机配置真实初始化默认门店菜单成功，当前时段为32个签池选项。
- 官方声明经联网重新比对，字节一致；本机 .env.local、.local/、Token、券标识、订单数据和历史参考截图未纳入 Git。
- 公开 main 保留原初始化提交，本地 main 已同步；原本地提交保留在 master。
- 桌面与手机验证细节见 [VALIDATION.md](VALIDATION.md)。真实创建订单和支付闭环仍未验证。
- 未实际使用 WorkBuddy 开发，不提交 workbuddy.md，不申报对应专项奖励。

官方活动：https://github.com/M-China/mcd-developer-innovation-challenge

报名截止：2026-10-25 23:59（北京时间）。
