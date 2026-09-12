import React from "react";
import { apiFetch, apiUrl } from "./apiClient";
import "./KnowledgeCenter.css";

type Document = {
  id: string;
  appId?: string;
  title: string;
  source?: string;
  characters: number;
  chunks: number;
  createdBy: string;
  createdAt: string;
};

type Hit = {
  documentId: string;
  title: string;
  source?: string;
  appId?: string;
  chunkId: string;
  text: string;
  score: number;
};

export function KnowledgeCenter() {
  const [documents, setDocuments] = React.useState<Document[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const [form, setForm] = React.useState({ title: "", source: "", appId: "", text: "" });
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [context, setContext] = React.useState("");
  const [searching, setSearching] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(apiUrl("/api/knowledge/documents"));
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "知识库加载失败");
      setDocuments(result.documents || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "知识库加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function addDocument() {
    if (!form.title.trim() || !form.text.trim()) {
      setMessage("请填写知识标题和正文。");
      return;
    }

    const response = await apiFetch(apiUrl("/api/knowledge/documents"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        source: form.source || undefined,
        appId: form.appId || undefined,
        text: form.text
      })
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      setMessage(result.error || "知识导入失败");
      return;
    }

    setForm({ title: "", source: "", appId: "", text: "" });
    setMessage("知识已切分并写入企业知识库。");
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("确定删除这份知识文档吗？")) return;
    const response = await apiFetch(apiUrl(`/api/knowledge/documents/${encodeURIComponent(id)}`), {
      method: "DELETE"
    });
    const result = await response.json();
    setMessage(response.ok && result.ok ? "知识文档已删除。" : result.error || "删除失败");
    if (response.ok && result.ok) await load();
  }

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setMessage("");
    try {
      const response = await apiFetch(apiUrl("/api/knowledge/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 8, maxCharacters: 7000 })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "知识检索失败");
      setHits(result.hits || []);
      setContext(result.context || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "知识检索失败");
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="knowledgeCenter">
      <div className="knowledgeHeading">
        <div>
          <span>ENTERPRISE KNOWLEDGE</span>
          <h1>企业知识库</h1>
          <p>把制度、产品资料、FAQ、项目文档和业务知识切分为可检索上下文，为 Agent、Skill 和 AI 应用提供组织级 RAG 基础。</p>
        </div>
        <div className="knowledgeMetric"><strong>{documents.length}</strong><span>知识文档</span></div>
      </div>

      {message && <div className="knowledgeMessage">{message}</div>}

      <div className="knowledgeGrid">
        <article className="knowledgePanel">
          <h2>导入知识</h2>
          <p>当前版本支持直接粘贴文本；文件中心中的文档可后续通过解析 Skill 自动导入。</p>
          <div className="knowledgeForm">
            <input value={form.title} placeholder="标题，例如：支付产品接入规范" onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            <input value={form.source} placeholder="来源，例如：运营中心 / Confluence / 合同" onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} />
            <input value={form.appId} placeholder="可选：限定到某个 App ID" onChange={(event) => setForm((current) => ({ ...current, appId: event.target.value }))} />
            <textarea rows={12} value={form.text} placeholder="粘贴企业知识正文…" onChange={(event) => setForm((current) => ({ ...current, text: event.target.value }))} />
            <button onClick={() => void addDocument()}>＋ 导入并切分</button>
          </div>
        </article>

        <article className="knowledgePanel searchPanel">
          <h2>RAG 检索</h2>
          <p>输入业务问题，系统会返回组织内最相关的知识片段与可直接交给模型的上下文。</p>
          <div className="knowledgeSearch">
            <input value={query} placeholder="例如：支付商户进件需要哪些资料？" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} />
            <button disabled={searching} onClick={() => void search()}>{searching ? "检索中…" : "检索"}</button>
          </div>

          <div className="knowledgeHits">
            {hits.map((hit) => (
              <div className="knowledgeHit" key={hit.chunkId}>
                <div><strong>{hit.title}</strong><span>相关度 {hit.score}{hit.source ? ` · ${hit.source}` : ""}</span></div>
                <p>{hit.text}</p>
              </div>
            ))}
            {!searching && query && hits.length === 0 && <div className="knowledgeEmpty">暂无匹配知识。</div>}
          </div>

          {context && (
            <details className="knowledgeContext">
              <summary>查看模型上下文</summary>
              <pre>{context}</pre>
            </details>
          )}
        </article>
      </div>

      <article className="knowledgePanel documentPanel">
        <div className="knowledgePanelTitle"><div><h2>已入库文档</h2><p>组织级隔离；可选绑定具体企业应用。</p></div><button onClick={() => void load()}>刷新</button></div>
        <div className="documentList">
          {documents.map((item) => (
            <div className="documentItem" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.source || "企业知识"}{item.appId ? ` · ${item.appId}` : " · 全组织"}</span>
              </div>
              <div className="documentMeta"><span>{item.characters.toLocaleString()} 字符</span><span>{item.chunks} 片段</span><span>{new Date(item.createdAt).toLocaleString()}</span></div>
              <button onClick={() => void remove(item.id)}>删除</button>
            </div>
          ))}
          {!loading && documents.length === 0 && <div className="knowledgeEmpty">尚未导入企业知识。</div>}
        </div>
      </article>
    </section>
  );
}
