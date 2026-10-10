# MCP 接入说明

官方服务：https://mcp.mcd.cn
官方指南：https://github.com/M-China/mcd-mcp-server

## 业务用途与真实验证

饭签使用真实到店菜单建立抽餐签池，并查询套餐默认搭配。用户选定后仍需确认吃过，才能进入周／月用餐回顾。

2026-10-09 已成功完成初始化、工具发现（35个工具）和三种业务查询：

| Tool | 参数 | 结果 |
| --- | --- | --- |
| query-nearby-stores | city=呼和浩特，keyword=万达广场，searchType=2，beType=1 | 匹配麦当劳呼和浩特新华东街餐厅1980064 |
| query-meals | storeCode=1980064，orderType=1，beType=1 | 15类别、127餐品条目；当前筛出24个正餐、19个小吃甜品、21个饮品选项 |
| query-meal-detail | storeCode=1980064，code=9900005456，orderType=1，beType=1 | 麦辣鸡腿汉堡三件套默认搭配：汉堡、中薯条、中杯可乐 |

以上是查询时快照，不保证后续价格和供应。浏览器验证也实际查询过其他抽到的套餐搭配。

## 实现

scripts/mcp-discovery.mjs 实现 Streamable HTTP，流程 initialize → notifications/initialized → tools/list 或 tools/call，支持2025-03-26协议的JSON/SSE响应。会话头只在本次连接使用，分页有限次，响应大小与等待时间有上限。

公共菜单调用仍只允许上述三种工具；独立 checkout 入口增加 query-store-coupons、calculate-price、create-order 和 query-order，仅允许到店自取参数。demo/server.mjs 仅监听127.0.0.1，校验Host与Origin，静态文件使用允许列表。详情餐品编码必须来自当前签池。

demo/menu-adapter.mjs 排除多人餐、会员／身份优惠、附加购、周边和酱料，分类提供正餐套餐、小吃甜品与饮品咖啡，只向网页提供门店公共信息、餐名、图片、参考价格和查询时间。菜单清洗属于本项目规则，不能据此保证任意门店数据都适用。

## 凭据

MCD_MCP_TOKEN 环境变量优先，其次本机.env.local；只发送到固定官方HTTPS地址，禁止跟随重定向。错误信息脱敏，Token不进入前端和公开说明。原始快照保存在被Git忽略的.local/，不可提交。

mcp-config.example.json 仅有环境变量占位符。

## 验证与限制

原有42项测试通过：协议协商、JSON/SSE、分页、错误脱敏、只读调用限制、日期边界、记录去重、抽取候选与菜单过滤。

桌面及手机尺寸浏览器验证通过真实菜单／详情、抽取、选择与实际记录分离、周／月、持久化、编辑删除。创建订单与查询订单使用模拟数据验证；真实优惠查询返回空列表。开发过程未创建真实订单、未领券或支付。

当前为支持地点搜索和门店切换的本地单用户演示；公共托管需要独立后端凭据方案，不能将本机Token发布到浏览器。


## 到店自取订单（2026-10-10）

真实 calculate-price 成功：data.price=3350分；data.takeWayList包含eat-in（堂食）与take-in-store（外带／店内自提）。第一版过滤为外带，不编造取餐编码。

checkout-model.mjs 从真实详情组装默认 roundList 与 modification；保留明确选中项的selectedKey及有unselectedKey的未选中项。未提供明确默认搭配时停止下单。

checkout-service.mjs 使用服务端quoteId保存餐品、数量、默认规格与90秒实时报价，提交前再算价；价格／取餐选项变化后返回新确认信息。客户端不提交任意金额或餐品数组。create-order仅在明确confirmed后调用；服务端在调用前持久化pending，按选定drawId防连点和重启重试。未知结果保留unknown／pending，需在麦当劳App核对。

新增接口：POST /api/checkout/quote、POST /api/checkout/submit、GET /api/checkout/status。POST校验同源Origin和JSON正文限制；订单日志仅存.local/orders.json，不向网页发送原始业务响应或Token。

原有42项测试通过；真实默认套餐核价和确认页通过；create-order/query-order的交易流程使用模拟验证，没有真实创建订单或支付。正式首次下单时仍需验证实际创建返回格式及支付闭环；无法识别订单号时不伪报成功、不重试。支付链接仅允许麦当劳域名HTTPS，其他情况引导用户在麦当劳App查看。

此版本使用本机个人Token，公共多用户部署需要独立用户授权与账号隔离。


## 门店搜索与优惠比较

2026-10-10接入query-store-coupons（storeCode、orderType=1、beType=1）；实际返回success=true、data=[]。非空券解析目前支持couponId、couponCode与couponName/name，仅识别明确ID与编码；真实非空返回尚未验证。

menu-service.mjs维护由位置搜索取得的公共门店与各店独立菜单；报价捕获门店快照，不依赖全局“当前门店”。POST /api/stores/search支持city+keyword，到店beType=1；新增报价storeCode与POST /api/checkout/coupon。

coupon-service.mjs试算不用券及最多20张可识别单券，只接受calculate-price返回productList中的餐品编码和数量与原选择一致的方案。按data.price（分）比较，金额相同优先保留券。查询失败提供明确无券基线，覆盖不完整时不宣称全局最优。

所有couponId/couponCode只存于服务端报价内；网页接收opaque couponKey、名称、实付与节省额。换券生成新quoteId，旧报价不能提交；提交前券失效要求重新确认无券金额。没有调用自动领券或创建真实订单。原始券查询回包仅存.local/，不会提交Git。
