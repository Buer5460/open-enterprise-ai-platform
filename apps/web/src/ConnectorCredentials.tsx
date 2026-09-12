import React from "react";
import { apiFetch, apiUrl } from "./apiClient";
import "./ConnectorCredentials.css";

type Credential = {
  connectorId: string;
  keys: string[];
  updatedAt: string;
};

export function ConnectorCredentials() {
  const [items, setItems] = React.useState<Credential[]>([]);
  const [connectorId, setConnectorId] = React.useState("");
  const [valuesText, setValuesText] = React.useState('{\n  "API_KEY": ""\n}');
  const [clearText, setClearText] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(apiUrl("/api/connectors/credentials"));
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Connector 凭证加载失败");
      }
      setItems(result.credentials || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connector 凭证加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const id = connectorId.trim();
    if (!id) {
      setMessage("请填写 Connector ID。");
      return;
    }

    let values: Record<string, string> = {};
    try {
      const parsed = JSON.parse(valuesText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("凭证必须是 JSON 对象");
      }
      values = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")])
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "凭证 JSON 无效");
      return;
    }

    const clear = clearText
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

    setSaving(true);
    setMessage("");
    try {
      const response = await apiFetch(
        apiUrl(`/api/connectors/${encodeURIComponent(id)}/credentials`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values, clear })
        }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "凭证保存失败");
      }
      setMessage("Connector 凭证已加密保存；已有密钥值不会回显到浏览器。");
      setConnectorId("");
      setValuesText('{\n  "API_KEY": ""\n}');
      setClearText("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "凭证保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(`确定删除 ${id} 的全部已保存凭证吗？`)) return;
    const response = await apiFetch(
      apiUrl(`/api/connectors/${encodeURIComponent(id)}/credentials`),
      { method: "DELETE" }
    );
    const result = await response.json();
    setMessage(response.ok && result.ok ? "Connector 凭证已删除。" : result.error || "删除失败");
    if (response.ok && result.ok) await load();
  }

  function edit(item: Credential) {
    setConnectorId(item.connectorId);
    setValuesText(
      JSON.stringify(
        Object.fromEntries(item.keys.map((key) => [key, ""])),
        null,
        2
      )
    );
    setClearText("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="credentialCenter">
      <div className="credentialHeading">
        <div>
          <span>CONNECTOR SECRET VAULT</span>
          <h1>Connector 凭证库</h1>
          <p>按企业组织加密保存 API Key、Token、账号密码等 Connector 凭证。浏览器只能看到已配置的字段名，不会读取明文密钥。</p>
        </div>
        <div className="credentialMetric"><strong>{items.length}</strong><span>已配置 Connector</span></div>
      </div>

      {message && <div className="credentialMessage">{message}</div>}

      <div className="credentialGrid">
        <article className="credentialPanel">
          <h2>配置凭证</h2>
          <p>留空的值不会覆盖服务器端已有密钥；需要删除某个字段时，在“清除字段”中填写字段名。</p>
          <label><span>Connector ID</span><input value={connectorId} placeholder="例如：payment.yeepay-connector" onChange={(event) => setConnectorId(event.target.value)} /></label>
          <label><span>凭证 JSON</span><textarea rows={11} value={valuesText} onChange={(event) => setValuesText(event.target.value)} /></label>
          <label><span>清除字段（逗号或换行分隔）</span><textarea rows={3} value={clearText} placeholder="OLD_TOKEN\nLEGACY_PASSWORD" onChange={(event) => setClearText(event.target.value)} /></label>
          <button disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "加密保存"}</button>
        </article>

        <article className="credentialPanel">
          <div className="credentialPanelTitle"><div><h2>已配置凭证</h2><p>这里只展示字段名和更新时间。</p></div><button onClick={() => void load()}>刷新</button></div>
          <div className="credentialList">
            {items.map((item) => (
              <div className="credentialItem" key={item.connectorId}>
                <div><strong>{item.connectorId}</strong><span>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ""}</span></div>
                <div className="credentialKeys">{item.keys.map((key) => <code key={key}>{key}</code>)}</div>
                <div className="credentialActions"><button onClick={() => edit(item)}>更新</button><button className="danger" onClick={() => void remove(item.connectorId)}>删除</button></div>
              </div>
            ))}
            {!loading && items.length === 0 && <div className="credentialEmpty">尚未配置 Connector 凭证。</div>}
          </div>
        </article>
      </div>
    </section>
  );
}
