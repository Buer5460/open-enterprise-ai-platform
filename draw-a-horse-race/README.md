# Draw a Horse · Then Race It

手机 H5 多人画马赛跑项目。用户自己画一匹马，创建/加入房间，3–8 人即可比赛；服务端生成一整场约 12 秒的统一赛程，所有手机同步看到起跑、追赶、反超、冲刺和冲线。

## 已完成

- 手机 Canvas 画马、撤销、清空、马名与属性生成
- 本地马匹保存 + 服务端用户档案
- 4 位房间号、分享链接自动进房
- 真实 Socket.IO 多人房间同步
- 公开等待房间列表
- 3–8 匹马比赛；房主也可添加试玩 AI 马测试
- 12 秒完整赛马过程，200ms 服务端轨迹采样，前端逐帧插值
- 起跑 / 中段 / 反超 / 最后冲刺赛事解说
- 每日 +100 免费积分
- 封闭式积分竞猜，竞猜积分不出售、不提现、不转账、不兑换现金
- 比赛结算、积分结算、排行榜、最近比赛记录
- 比赛结束后房主可以“再来一局”
- 用户刷新/断线后可重新进入原房间；比赛中重连可恢复到当前赛程时间
- JSON 文件持久化用户、房间、积分、比赛历史
- 服务进程在比赛中意外退出时，恢复后会退还未结算竞猜积分并重新开放大厅
- 特效商店与支付适配层
- 易宝支付服务端接入位置预留：`/rest/v1.0/aggpay/pre-pay`
- 运营后台 `/admin.html`
- Docker / Docker Compose / Render Blueprint 部署文件
- Node 自动测试与语法自检

## 快速启动

要求 Node.js 20+。

```bash
npm install
npm run check
npm test
npm start
```

打开：

```text
http://localhost:3088
```

局域网多手机测试时，把 `PUBLIC_BASE_URL` 设置为手机能够访问的电脑 IP 地址，例如：

```text
PUBLIC_BASE_URL=http://192.168.1.20:3088
```

## Docker

```bash
docker compose up -d --build
```

数据写入 `./data/store.json`。

## 核心目录

```text
public/
  index.html       H5 页面
  app.js           画马、房间、竞猜、比赛动画、排行榜、商店
  styles.css       移动端样式
  admin.html       运营后台
src/
  race-engine.js   服务端赛马轨迹引擎
  store.js         用户/积分/房间/赛果持久化
  payment/index.js 支付适配层
server.js          Express + Socket.IO 服务
render.yaml        Render Blueprint
compose.yaml       Docker Compose
tests/             自动测试
```

## 比赛为什么不会“瞬移”

`src/race-engine.js` 每场生成：

- 12,000ms 赛程
- 每 200ms 一个 checkpoint（60+ 帧服务端轨迹）
- 每匹马有速度、耐力、爆发、幸运属性
- 起跑、中段、冲刺使用不同速度因子
- 随机幸运爆发与极低概率失速
- 客户端在相邻 checkpoint 之间使用 `requestAnimationFrame` 插值

因此位置持续变化，而不是一次性把最终名次发给前端。

## 积分规则

- 新用户：200 积分
- 每日首次领取：+100
- 单次竞猜：10–500
- MVP 固定返还倍率：×2
- 竞猜积分与真实人民币支付完全隔离
- 不提供积分购买、提现、转账、现金或实物兑付

## 支付

真实支付仅用于虚拟商品（皮肤、AI 卡片、动画、特效）。

推荐链路：

```text
H5
 → 自有后端 /api/payment/create
 → 易宝 /rest/v1.0/aggpay/pre-pay
 → 微信 / 支付宝
 → 易宝 notifyUrl
 → 后端查单确认终态
 → 发放虚拟商品
```

`.env` 支持：

```text
PAYMENT_MODE=disabled | mock | yeepay
```

- `disabled`：默认，支付关闭，游戏全部免费功能可用
- `mock`：测试商店流程，不产生真实资金
- `yeepay`：需要实际商户 AppKey、商户号、私钥文件和通知地址后做最后生产/沙箱联调

**不要把任何生产私钥提交到 GitHub。**

## 运营后台

配置：

```text
ADMIN_TOKEN=your-secret-token
```

访问：

```text
/admin.html
```

可查看用户、实时房间、比赛数、积分总量和最近比赛。

## 上线前最后两项外部授权

代码本身可运行。要变成公网商业版，还需要项目所有者提供：

1. 公网部署平台/服务器的账号授权（或服务器 SSH / 部署平台连接）；
2. 若启用真实收款，提供易宝测试/生产商户环境所需参数，由服务端安全配置，不进入代码仓库。
