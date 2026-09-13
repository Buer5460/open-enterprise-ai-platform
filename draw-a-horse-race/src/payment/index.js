import crypto from "node:crypto";
import { recordPurchase } from "../store.js";

export const SHOP = {
  horse_fx_190: { skuId: "horse_fx_190", name: "马匹冲刺特效", amount: "1.90" },
  horse_skin_290: { skuId: "horse_skin_290", name: "限定马匹皮肤", amount: "2.90" },
  ai_card_390: { skuId: "ai_card_390", name: "AI 马匹故事卡", amount: "3.90" }
};

export function paymentConfig() {
  const mode = process.env.PAYMENT_MODE || "disabled";
  return { mode, enabled: mode === "mock" || mode === "yeepay", provider: mode === "yeepay" ? "Yeepay" : mode };
}

export async function createPayment({ userId, skuId, returnUrl }) {
  const sku = SHOP[skuId];
  if (!sku) return { ok: false, status: 400, message: "商品不存在" };
  const mode = process.env.PAYMENT_MODE || "disabled";
  const orderId = `DHR${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  if (mode === "mock") {
    const purchase = { orderId, userId, skuId, amount: sku.amount, status: "PAID", provider: "mock" };
    recordPurchase(purchase);
    return { ok: true, status: 200, order: purchase, redirectUrl: returnUrl || "/?paid=1" };
  }

  if (mode === "yeepay") {
    const required = ["YEEPAY_APP_KEY", "YEEPAY_MERCHANT_NO", "YEEPAY_PRIVATE_KEY_PATH", "YEEPAY_NOTIFY_URL"];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length) return { ok: false, status: 503, message: `易宝尚未完成授权配置：${missing.join(", ")}`, missing };
    return { ok: false, status: 501, message: "易宝商户参数已检测到，需要拿实际商户环境完成最终 YOP 签名联调。", intendedApi: "/rest/v1.0/aggpay/pre-pay", orderId };
  }

  return { ok: false, status: 503, message: "支付当前关闭；游戏核心功能不受影响。" };
}
