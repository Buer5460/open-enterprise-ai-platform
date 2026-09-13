# 生产上线清单

当前代码可以本地运行，也具备 Docker 与 Render 部署文件。要变成公网可分享的 H5，只剩外部账号/密钥相关配置。

## 1. 推荐部署参数

项目根目录：

```text
draw-a-horse-race
```

运行：

```bash
npm install
npm run check
npm test
npm start
```

端口：

```text
3088
```

健康检查：

```text
/api/health
```

必须使用持久化目录：

```text
/app/data
```

否则免费实例重建后积分、房间和赛果会丢失。

## 2. 环境变量

最少配置：

```text
PORT=3088
PUBLIC_BASE_URL=https://你的正式域名
DATA_FILE=data/store.json
ADMIN_TOKEN=随机长字符串
PAYMENT_MODE=disabled
```

初次公网测试建议保持：

```text
PAYMENT_MODE=disabled
```

这样所有游戏、房间、积分、竞猜、排行榜均可使用，但不会发生真实资金交易。

## 3. 易宝真实支付

只用于马匹特效、皮肤、AI 卡片等虚拟商品，不用于购买竞猜积分。

启用前需要在服务器 Secret/Environment 中安全配置：

```text
PAYMENT_MODE=yeepay
YEEPAY_APP_KEY=
YEEPAY_MERCHANT_NO=
YEEPAY_PRIVATE_KEY_PATH=
YEEPAY_NOTIFY_URL=https://你的正式域名/api/payment/yeepay/notify
```

私钥文件只能放在服务器 Secret/File Secret 中，禁止提交 GitHub，也不要粘贴到公开聊天或 Issue。

当前适配层已经锁定易宝：

```text
POST /rest/v1.0/aggpay/pre-pay
```

真实联调需要商户测试/生产环境信息后补齐 YOP 签名、回调验签、主动查单和幂等发货。

## 4. 域名 / 微信传播

若主要从微信好友、微信群、公众号传播，正式商业运营还需要：

- HTTPS 正式域名
- 根据实际主体完成相应域名/备案合规工作
- 若需要微信网页授权/公众号支付，配置公众号 AppID、网页授权域名、支付授权目录等
- 分享卡片可在第二阶段接微信 JS-SDK；普通链接分享不影响游戏本身运行

## 5. 当前数据层边界

V1 使用 JSON 文件持久化，适合 MVP、活动测试和早期运营。

当出现以下任一情况时升级 PostgreSQL + Redis：

- 日活进入数千级并持续增长
- 多实例横向扩容
- 同时大量比赛房间
- 需要正式财务级订单与商品权益账本

游戏协议和前端无需因此重写，只替换持久化/Socket.IO Adapter。

## 6. 上线验收流程

1. 打开正式域名，画马并创建房间。
2. 手机 A 分享链接给手机 B、C。
3. B、C 画马后自动进入同一房间。
4. 房主确认出现 3 匹马。
5. 三台手机看到相同倒计时和约 12 秒赛程。
6. 核对领先、反超、冲刺与最终名次一致。
7. 刷新其中一台手机，确认能重新进入房间。
8. 领取每日积分、下积分竞猜、比赛后核对结算。
9. 查看排行榜。
10. 使用 `/admin.html` + `ADMIN_TOKEN` 查看运营数据。
11. 最后才开启支付测试模式/易宝测试环境。

## 7. 需要项目所有者授权的事项

只有下面事项必须由项目所有者授权或提供外部账号权限：

- 公网云部署账号（Render / Railway / VPS 等）或服务器部署权限
- 正式域名与 DNS 管理权限（如需要绑定自有域名）
- 易宝商户测试/生产配置（如果启用真实付款）
- 微信公众号相关配置（如果启用公众号登录、JS-SDK 分享或微信内公众号支付）

除此之外的软件代码均在 GitHub 项目内维护。
