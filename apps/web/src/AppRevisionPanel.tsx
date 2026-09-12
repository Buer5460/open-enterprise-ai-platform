import React from "react";

type Props = {
  app: any;
  onUpdated: (app: any) => void;
};

export function AppRevisionPanel({
  app,
  onUpdated
}: Props) {
  const [instruction, setInstruction] =
    React.useState("");

  const [working, setWorking] =
    React.useState(false);

  const [message, setMessage] =
    React.useState("");

  async function revise() {
    const value = instruction.trim();

    if (!value) {
      setMessage("请先描述你希望修改什么。");
      return;
    }

    setWorking(true);
    setMessage("AI 正在分析现有应用并生成安全修改方案……");

    try {
      const response = await fetch(
        `http://127.0.0.1:8787/api/apps/${encodeURIComponent(app.id)}/revise`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            instruction: value
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "应用修改失败"
        );
      }

      setInstruction("");
      setMessage(
        `修改完成：v${result.previousVersion ?? app.version} → v${result.version ?? result.app?.version ?? app.version}`
      );

      onUpdated(result.app);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "应用修改失败"
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="aiRevisionPanel">
      <div className="aiRevisionCopy">
        <span>AI APP EVOLUTION</span>
        <h3>直接告诉 AI：这个应用还要怎么改？</h3>
        <p>
          AI 会读取当前 Blueprint，在尽量保留已有页面、字段和真实数据的前提下升级应用，并自动迁移新增字段。
        </p>
      </div>

      <div className="aiRevisionComposer">
        <textarea
          value={instruction}
          disabled={working}
          onChange={(event) =>
            setInstruction(event.target.value)
          }
          placeholder="例如：客户增加身份证号和微信字段；订单增加退款状态；再新增一个客户回访页面。"
          rows={3}
        />

        <button
          disabled={working}
          onClick={() => void revise()}
        >
          {working
            ? "AI 正在修改…"
            : "让 AI 修改应用"}
        </button>
      </div>

      {message && (
        <div className="aiRevisionMessage">
          {message}
        </div>
      )}
    </section>
  );
}
