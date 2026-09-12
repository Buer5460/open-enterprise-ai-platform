import React from "react";
import { apiFetch, apiUrl } from "./apiClient";
import "./PublisherCenter.css";

type PackageItem = {
  id: string;
  type: string;
  displayName: string;
  version: string;
  publisher: string;
  source: string;
  status: string;
};

type PublisherStatus = {
  configured: boolean;
  target?: {
    owner: string;
    repository: string;
    branch: string;
    prefix: string;
  };
};

type ImportStatus = {
  hasToken: boolean;
  trustedFingerprints: string[];
};

type PackageState = {
  provenance?: {
    generatedAt: string;
    publicKeyFingerprint: string;
    contentDigest: string;
    signature: string;
  };
  verified?: boolean;
  reason?: string;
};

export function PublisherCenter() {
  const [packages, setPackages] = React.useState<PackageItem[]>([]);
  const [publisher, setPublisher] = React.useState<PublisherStatus>({ configured: false });
  const [importStatus, setImportStatus] = React.useState<ImportStatus>({
    hasToken: false,
    trustedFingerprints: []
  });
  const [states, setStates] = React.useState<Record<string, PackageState>>({});
  const [working, setWorking] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [importing, setImporting] = React.useState(false);
  const [remote, setRemote] = React.useState({
    owner: "",
    repository: "",
    branch: "main",
    prefix: "",
    expectedFingerprint: ""
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [catalogResponse, publisherResponse, importResponse] = await Promise.all([
        apiFetch(apiUrl("/api/platform/packages")),
        apiFetch(apiUrl("/api/developer/github-publisher")),
        apiFetch(apiUrl("/api/marketplace/import/github/status"))
      ]);
      const [catalogResult, publisherResult, importResult] = await Promise.all([
        catalogResponse.json(),
        publisherResponse.json().catch(() => ({})),
        importResponse.json().catch(() => ({}))
      ]);

      if (!catalogResponse.ok || !catalogResult.ok) {
        throw new Error(catalogResult.error || "Package 目录加载失败");
      }

      const published = (catalogResult.packages || []).filter(
        (item: PackageItem) =>
          item.source === "developer" &&
          item.status === "available"
      );
      setPackages(published);

      setPublisher(
        publisherResponse.ok && publisherResult.ok
          ? {
              configured: Boolean(publisherResult.configured),
              target: publisherResult.target
            }
          : { configured: false }
      );

      setImportStatus(
        importResponse.ok && importResult.ok
          ? {
              hasToken: Boolean(importResult.hasToken),
              trustedFingerprints:
                importResult.trustedFingerprints ?? []
            }
          : {
              hasToken: false,
              trustedFingerprints: []
            }
      );

      await Promise.all(
        published.map(async (item: PackageItem) => {
          try {
            const response = await apiFetch(
              apiUrl(`/api/developer/packages/${encodeURIComponent(item.id)}/provenance`)
            );
            const result = await response.json();
            if (response.ok && result.ok && result.provenance) {
              setStates((current) => ({
                ...current,
                [item.id]: {
                  ...current[item.id],
                  provenance: result.provenance
                }
              }));
            }
          } catch {
            // Unsigned packages are a valid state.
          }
        })
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布中心加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function signPackage(packageId: string) {
    return withPackage(packageId, async () => {
      const response = await apiFetch(
        apiUrl(`/api/developer/packages/${encodeURIComponent(packageId)}/provenance/sign`),
        { method: "POST" }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Package 签名失败");
      setStates((current) => ({
        ...current,
        [packageId]: {
          ...current[packageId],
          provenance: result.provenance,
          verified: true,
          reason: undefined
        }
      }));
      setMessage(`${packageId} 已生成 Ed25519 来源证明。`);
      return result.provenance;
    });
  }

  async function verifyPackage(packageId: string) {
    return withPackage(packageId, async () => {
      const response = await apiFetch(
        apiUrl(`/api/developer/packages/${encodeURIComponent(packageId)}/provenance/verify`),
        { method: "POST" }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Package 校验失败");
      setStates((current) => ({
        ...current,
        [packageId]: {
          ...current[packageId],
          provenance: result.provenance,
          verified: Boolean(result.valid),
          reason: result.reason
        }
      }));
      setMessage(
        result.valid
          ? `${packageId} 来源证明校验通过。`
          : `${packageId} 校验失败：${result.reason}`
      );
      return result;
    });
  }

  async function publishGitHub(packageId: string) {
    if (!publisher.configured) {
      setMessage("GitHub Publisher 尚未配置。请先在 Connector 凭证库为 oeap.github-publisher 保存 TOKEN、OWNER、REPOSITORY。");
      return;
    }

    return withPackage(packageId, async () => {
      const signed = states[packageId]?.provenance || await signDirect(packageId);
      if (!signed) throw new Error("Package 签名失败");

      const verifyResponse = await apiFetch(
        apiUrl(`/api/developer/packages/${encodeURIComponent(packageId)}/provenance/verify`),
        { method: "POST" }
      );
      const verifyResult = await verifyResponse.json();
      if (!verifyResponse.ok || !verifyResult.valid) {
        throw new Error(verifyResult.reason || "Package 来源证明校验失败");
      }

      const response = await apiFetch(
        apiUrl(`/api/developer/packages/${encodeURIComponent(packageId)}/publish/github`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "GitHub 发布失败");
      setMessage(
        `✅ ${packageId}@${result.version} 已推送到 ${result.repository} / ${result.branch}，共 ${result.files?.length ?? 0} 个文件。`
      );
      return result;
    });
  }

  async function importGitHubPackage() {
    if (!remote.owner.trim() || !remote.repository.trim()) {
      setMessage("请填写 GitHub Owner 和 Repository。");
      return;
    }
    if (
      !remote.expectedFingerprint.trim() &&
      importStatus.trustedFingerprints.length === 0
    ) {
      setMessage(
        "导入前必须指定可信发布者指纹，或在 Connector 凭证 oeap.github-marketplace 中配置 TRUSTED_FINGERPRINTS。"
      );
      return;
    }

    setImporting(true);
    setMessage("正在下载、扫描、校验签名和依赖……");

    try {
      const response = await apiFetch(
        apiUrl("/api/marketplace/import/github"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: remote.owner.trim(),
            repository: remote.repository.trim(),
            branch: remote.branch.trim() || "main",
            prefix: remote.prefix.trim(),
            expectedFingerprint:
              remote.expectedFingerprint.trim() || undefined
          })
        }
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const stage = result.stage ? `（${result.stage}）` : "";
        throw new Error(`${result.error || "导入失败"}${stage}`);
      }

      setMessage(
        `✅ 已安全导入 ${result.package.id}@${result.package.version}。静态扫描 ${result.scan.files} 个文件，发布者签名与可信指纹均通过。`
      );
      setRemote((current) => ({
        ...current,
        prefix: "",
        expectedFingerprint: ""
      }));
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "GitHub Package 导入失败"
      );
    } finally {
      setImporting(false);
    }
  }

  async function signDirect(packageId: string) {
    const response = await apiFetch(
      apiUrl(`/api/developer/packages/${encodeURIComponent(packageId)}/provenance/sign`),
      { method: "POST" }
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Package 签名失败");
    setStates((current) => ({
      ...current,
      [packageId]: {
        ...current[packageId],
        provenance: result.provenance,
        verified: true
      }
    }));
    return result.provenance;
  }

  async function withPackage<T>(
    packageId: string,
    task: () => Promise<T>
  ): Promise<T | undefined> {
    setWorking(packageId);
    setMessage("");
    try {
      return await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
      return undefined;
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="publisherCenter">
      <div className="publisherHeading">
        <div>
          <span>PACKAGE SUPPLY CHAIN</span>
          <h1>发布与来源证明</h1>
          <p>
            Developer Package 在进入远程仓库前生成内容摘要和 Ed25519 签名；外部 Package 则必须先完成静态扫描、签名验证和可信发布者校验，才允许进入当前企业 Marketplace。
          </p>
        </div>
        <div className={`publisherState ${publisher.configured ? "ready" : "pending"}`}>
          <strong>{publisher.configured ? "GitHub 已配置" : "GitHub 待配置"}</strong>
          <span>
            {publisher.target
              ? `${publisher.target.owner}/${publisher.target.repository} · ${publisher.target.branch}`
              : "oeap.github-publisher"}
          </span>
        </div>
      </div>

      {message && <div className="publisherMessage">{message}</div>}

      <div className="publisherPipeline">
        <span>Developer Studio</span><b>→</b><span>Local Marketplace</span><b>→</b><span>SHA-256</span><b>→</b><span>Ed25519</span><b>→</b><span>GitHub</span>
      </div>

      <article className="remoteImportPanel">
        <div className="remoteImportHeader">
          <div>
            <span>TRUSTED MARKETPLACE IMPORT</span>
            <h2>从 GitHub 安全导入 Package</h2>
            <p>不会直接执行远程源码。只有静态扫描、内容摘要、签名和可信发布者指纹全部通过后，Package 才进入企业 Marketplace。</p>
          </div>
          <div className="remoteImportState">
            <strong>{importStatus.hasToken ? "私有仓库凭证已配置" : "公开仓库模式"}</strong>
            <small>{importStatus.trustedFingerprints.length} 个已配置可信指纹</small>
          </div>
        </div>

        <div className="remoteImportGrid">
          <label>
            <span>GitHub Owner</span>
            <input value={remote.owner} onChange={(event) => setRemote((current) => ({ ...current, owner: event.target.value }))} placeholder="organization-or-user" />
          </label>
          <label>
            <span>Repository</span>
            <input value={remote.repository} onChange={(event) => setRemote((current) => ({ ...current, repository: event.target.value }))} placeholder="oeap-packages" />
          </label>
          <label>
            <span>Branch</span>
            <input value={remote.branch} onChange={(event) => setRemote((current) => ({ ...current, branch: event.target.value }))} placeholder="main" />
          </label>
          <label>
            <span>Package 目录</span>
            <input value={remote.prefix} onChange={(event) => setRemote((current) => ({ ...current, prefix: event.target.value }))} placeholder="packages/publisher/package-name" />
          </label>
          <label className="fingerprintInput">
            <span>可信发布者 Fingerprint</span>
            <input value={remote.expectedFingerprint} onChange={(event) => setRemote((current) => ({ ...current, expectedFingerprint: event.target.value }))} placeholder="sha256:…" />
          </label>
          <button disabled={importing} onClick={() => void importGitHubPackage()}>
            {importing ? "安全校验中…" : "扫描、验签并导入"}
          </button>
        </div>
      </article>

      <div className="publisherList">
        {packages.map((item) => {
          const state = states[item.id] || {};
          const busy = working === item.id;
          return (
            <article className="publisherPackage" key={item.id}>
              <div className="publisherPackageTitle">
                <div>
                  <span className="publisherType">{item.type}</span>
                  <h3>{item.displayName}</h3>
                  <code>{item.id}</code>
                </div>
                <strong>v{item.version}</strong>
              </div>

              <div className="provenanceInfo">
                <div><span>来源证明</span><strong>{state.provenance ? "已签名" : "未签名/远程导入"}</strong></div>
                <div><span>签名校验</span><strong>{state.verified === true ? "通过" : state.verified === false ? "失败" : "未校验"}</strong></div>
                <div><span>发布者</span><strong>{item.publisher}</strong></div>
              </div>

              {state.provenance && (
                <div className="fingerprint">
                  <span>Key fingerprint</span>
                  <code>{state.provenance.publicKeyFingerprint}</code>
                  <span>Content digest</span>
                  <code>{state.provenance.contentDigest}</code>
                </div>
              )}

              <div className="publisherActions">
                <button disabled={busy} onClick={() => void signPackage(item.id)}>签名</button>
                <button disabled={busy} onClick={() => void verifyPackage(item.id)}>验证</button>
                <button className="publishRemote" disabled={busy || !publisher.configured} onClick={() => void publishGitHub(item.id)}>
                  {busy ? "处理中…" : "推送 GitHub"}
                </button>
              </div>
            </article>
          );
        })}

        {!loading && packages.length === 0 && (
          <div className="publisherEmpty">
            当前企业还没有本地发布或安全导入的 Package。
          </div>
        )}
      </div>
    </section>
  );
}
