# Draw a Horse · Then Race It

一个面向手机 H5 的 UGC 社交赛马小游戏：

1. 用户在手机上画一匹马；
2. 创建或加入好友房间；
3. 3–8 人即可开赛；
4. 比赛不是瞬间结算，而是服务端生成约 12 秒完整赛程；
5. 多台手机收到同一份赛程轨迹，看到相同的领先、反超和冲刺过程；
6. 每天领取虚拟积分，可进行封闭式积分竞猜；
7. 后续商业化使用皮肤、AI 动画、赛道、品牌赛事，而不是现金押注。

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:3088
```

手机联调时把 `.env` 中 `PUBLIC_BASE_URL` 配成可被手机访问的域名或局域网地址。

## 目录

```text
draw-a-horse-race/
├─ public/
│  ├─ index.html
│  ├─ app.js
│  └─ styles.css
├─ src/
│  ├─ race-engine.js
│  └─ store.js
├─ data/
│  └─ store.example.json
├─ server.js
├─ package.json
├─ .env.example
└─ README.md
```

## 赛马过程

`src/race-engine.js` 在服务端生成整场比赛：

- 默认赛程：12 秒
- 轨迹采样：每 250ms 一个 checkpoint
- 起步阶段：0–20%
- 中段：20–72%
- 冲刺阶段：72–100%
- 每匹马受速度、耐力、爆发、幸运属性以及随机事件影响
- 马匹会在中途出现领先、落后、反超，而不是直接从起点跳到终点
- 客户端用 `requestAnimationFrame` 在 checkpoint 之间插值，保证动画连续

## 房间

Socket.IO 事件：

- `room:create`
- `room:join`
- `room:update`
- `bet:place`
- `race:start`
- `race:plan`
- `race:finish`

房间最少 3 人，最多 8 人。

## 积分

MVP 使用文件持久化：

- 首次用户 200 积分
- 每日领取 +100
- 竞猜最低 10、最高 500
- 积分不能提现、不能转账、不能兑换现金
- 正式商业化建议把付费货币与竞猜积分彻底分离

## 易宝支付

支付功能没有在浏览器端直连。

正式版建议：

```text
H5
 → 自有后端 /api/payment/create
 → 易宝 POST /rest/v1.0/aggpay/pre-pay
 → 微信/支付宝
 → 易宝 notifyUrl
 → 自有后端查单并发货
```

生产密钥不得提交到 GitHub。当前 `/api/payment/create` 仅为安全占位接口。

## 下一阶段

- PostgreSQL / MySQL 替换 JSON Store
- Redis + Socket.IO Adapter 支持多实例
- 微信公众号登录与分享卡片
- 马厩 / 赛季 / 排行榜
- AI 让手绘马生成动画
- 品牌活动后台
- 易宝沙箱联调
