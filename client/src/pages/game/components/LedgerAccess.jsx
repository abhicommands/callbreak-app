import React, { useRef, useState } from "react";
import CopyLinkButton from "../../../CopyLinkButton.jsx";
import { ledgerPath, randomHex, recoveryStorageKey, request } from "../../../api.js";
import { Card, btnStyle, inputStyle, lightBtnStyle } from "./ui.js";

export default function LedgerAccess({ seriesId, revision, editorKey, expiresAt, onEditor, onSnapshot }) {
  const [recoveryCode, setRecoveryCode] = useState(() => sessionStorage.getItem(recoveryStorageKey(seriesId)));
  const [secret, setSecret] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const recoveryAttempt = useRef(null);
  const shareUrl = `${window.location.origin}/ledger/${seriesId}`;

  const run = async (action) => {
    setBusy(true);
    setStatus("");
    try {
      await action();
    } catch (error) {
      setStatus(error.message || "Unable to complete the request.");
    } finally {
      setBusy(false);
    }
  };

  const signIn = (event) => {
    event.preventDefault();
    run(async () => {
      if (recovering) {
        if (recoveryAttempt.current?.secret !== secret.trim()) {
          recoveryAttempt.current = {
            key: crypto.randomUUID(), editor: randomHex(32), revision, secret: secret.trim(),
          };
        }
        const attempt = recoveryAttempt.current;
        let result;
        try {
          result = await request(`${ledgerPath(seriesId)}/recover`, {
            key: attempt.key, token: attempt.secret,
            body: { expectedRevision: attempt.revision, newEditorKey: attempt.editor },
          });
        } catch (error) {
          if (error.status && error.status < 500) recoveryAttempt.current = null;
          if (error.code === "STALE_REVISION") onSnapshot(await request(`${ledgerPath(seriesId)}/snapshot`));
          throw error;
        }
        onSnapshot(result.view);
        onEditor(attempt.editor);
        recoveryAttempt.current = null;
      } else {
        const token = secret.trim();
        await request(`${ledgerPath(seriesId)}/editor`, { token });
        onEditor(token);
      }
      setSecret("");
      setRecovering(false);
    });
  };

  const exportLedger = () => run(async () => {
    const backup = await request(`${ledgerPath(seriesId)}/export`, { token: editorKey });
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `callbreak-${seriesId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return (
    <Card>
      <div className="ledger-actions">
        <CopyLinkButton url={shareUrl} style={lightBtnStyle}>Copy Viewer Link</CopyLinkButton>
        {editorKey && (
          <button style={lightBtnStyle} disabled={busy} onClick={exportLedger}>Export Ledger</button>
        )}
      </div>
      {editorKey && (
        <p>{expiresAt
          ? `Expires ${new Date(expiresAt).toLocaleString()} if paid up and inactive. Unpaid balances are retained.`
          : "Outstanding balances are retained."}</p>
      )}
      {editorKey && recoveryCode && (
        <div className="ledger-recovery">
          <p>Save this recovery code privately. It lets you replace the editor code if you lose access.</p>
          <label>
            Recovery code
            <input style={inputStyle} value={recoveryCode} readOnly autoComplete="off" />
          </label>
          <button style={btnStyle} onClick={() => {
            sessionStorage.removeItem(recoveryStorageKey(seriesId));
            setRecoveryCode(null);
          }}>I Saved the Recovery Code</button>
        </div>
      )}
      {editorKey ? (
        <details className="ledger-recovery">
          <summary>Editor Access</summary>
          <label>
            Private editor code
            <input style={inputStyle} value={editorKey} readOnly autoComplete="off" />
          </label>
          <button style={lightBtnStyle} onClick={() => onEditor("")}>Lock Editing on This Device</button>
        </details>
      ) : (
        <details className="ledger-recovery">
          <summary>Unlock Editing</summary>
          <form onSubmit={signIn}>
            <label>
              {recovering ? "Recovery code" : "Private editor code"}
              <input style={inputStyle} type="password" value={secret}
                onChange={(event) => setSecret(event.target.value)} autoComplete="off" required />
            </label>
            <div className="ledger-actions">
              <button style={btnStyle} disabled={busy} type="submit">
                {recovering ? "Replace Editor Code" : "Unlock Editing"}
              </button>
              <button style={lightBtnStyle} type="button" disabled={busy} onClick={() => {
                setRecovering(!recovering);
                setSecret("");
              }}>{recovering ? "Use Editor Code" : "Use Recovery Code"}</button>
            </div>
          </form>
        </details>
      )}
      {status && <p role="status">{status}</p>}
    </Card>
  );
}
