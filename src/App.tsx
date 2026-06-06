import { useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";

type ParsedEmail = {
  id: string;
  subject?: string;
  body?: string;
  workDate?: string;
  workPlace?: string;
  startTime?: string;
  endTime?: string;
  mealTime?: string;
  workHours?: number;
  customer?: string;
  workers?: string;
  overtime?: string;
  meetingPlace?: string;
};

function getValue(text: string, label: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim());

  const index = lines.findIndex(
    (line) => line === `[${label}]`
  );

  if (index === -1) return undefined;

  return lines[index + 1];
}

function calcWorkHours(
  startTime?: string,
  endTime?: string,
  mealTime?: string
) {
  if (!startTime || !endTime) return undefined;

  const [startHour, startMinute] = startTime
    .split(":")
    .map(Number);

  const [endHour, endMinute] = endTime
    .split(":")
    .map(Number);

  let workMinutes =
    endHour * 60 +
    endMinute -
    (startHour * 60 + startMinute);

  if (mealTime) {
    const match = mealTime.match(
      /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/
    );

    if (match) {
      const [mealStartHour, mealStartMinute] =
        match[1].split(":").map(Number);

      const [mealEndHour, mealEndMinute] =
        match[2].split(":").map(Number);

      const mealMinutes =
        mealEndHour * 60 +
        mealEndMinute -
        (mealStartHour * 60 + mealStartMinute);

      workMinutes -= mealMinutes;
    }
  }

  return workMinutes / 60;
}

function extractBodyData(payload: any): string | undefined {
  if (!payload) return undefined;
  if (payload.body?.data) return payload.body.data;

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const data = extractBodyData(part);
      if (data) return data;
    }
  }

  return undefined;
}

function decodeBodyData(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );

  return decodeURIComponent(escape(atob(padded)));
}

function App() {
  const [emails, setEmails] = useState<ParsedEmail[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const appendLog = (message: string) => {
    setLogs((prev) => [...prev, message]);
    console.log(message);
  };

  const login = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/gmail.readonly",

    onSuccess: async (tokenResponse) => {
      setLoading(true);
      setError(undefined);
      setEmails([]);
      setLogs([]);

      appendLog("ログイン成功");

      try {
        const response = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=subject:作業確認",
          {
            headers: {
              Authorization: `Bearer ${tokenResponse.access_token}`,
            },
          }
        );

        const data = await response.json();

        appendLog("作業確認メール一覧取得完了");
        appendLog(JSON.stringify(data, null, 2));

        if (!data.messages || data.messages.length === 0) {
          appendLog("作業確認メールが見つかりません");
          return;
        }

        const messageList = data.messages as { id: string }[];
        appendLog(`対象メール数: ${messageList.length}`);

        const parsedEmails = await Promise.all(
          messageList.map(async (message) => {
            const mailResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
              {
                headers: {
                  Authorization: `Bearer ${tokenResponse.access_token}`,
                },
              }
            );

            const mailData = await mailResponse.json();
            const subjectHeader = mailData.payload.headers.find(
              (header: any) => header.name === "Subject"
            );
            const subject = subjectHeader?.value;
            const bodyData = extractBodyData(mailData.payload);
            const decodedBody = bodyData ? decodeBodyData(bodyData) : undefined;

            if (!decodedBody) {
              appendLog(`メール ${message.id} の本文が見つかりません`);
            }

            const workDate = decodedBody ? getValue(decodedBody, "作業日") : undefined;
            const workPlace = decodedBody ? getValue(decodedBody, "詳細現場名") : undefined;
            const startTime = decodedBody ? getValue(decodedBody, "始業時刻") : undefined;
            const endTime = decodedBody ? getValue(decodedBody, "終業時刻") : undefined;
            const customer = decodedBody ? getValue(decodedBody, "顧客名称") : undefined;
            const workers = decodedBody ? getValue(decodedBody, "現場人数") : undefined;
            const overtime = decodedBody ? getValue(decodedBody, "残業") : undefined;
            const meetingPlace = decodedBody ? getValue(decodedBody, "集合場所名称") : undefined;
            const mealTime = decodedBody ? getValue(decodedBody, "食事時間") : undefined;

            const workHours = calcWorkHours(startTime, endTime, mealTime);

            appendLog(`メール【${subject || message.id}】を解析しました`);

            return {
              id: message.id,
              subject,
              body: decodedBody,
              workDate,
              workPlace,
              startTime,
              endTime,
              mealTime,
              workHours,
              customer,
              workers,
              overtime,
              meetingPlace,
            };
          })
        );

        setEmails(parsedEmails);
      } catch (fetchError) {
        appendLog("メール取得中にエラーが発生しました");
        setError("メールの取得中にエラーが発生しました。コンソールログを確認してください。");
      } finally {
        setLoading(false);
      }
    },

    onError: () => {
      appendLog("ログイン失敗");
      setError("Gmailログインに失敗しました。");
      setLoading(false);
    },
  });

  return (
    <div style={{ padding: "40px", fontFamily: "sans-serif" }}>
      <h1>Shift Income Manager</h1>

      <button
        onClick={() => login()}
        disabled={loading}
        style={{ padding: "10px 16px", fontSize: "16px" }}
      >
        {loading ? "読み込み中..." : "Gmailに接続"}
      </button>

      {error && (
        <div style={{ marginTop: "16px", color: "#d32f2f" }}>
          {error}
        </div>
      )}

      <section style={{ marginTop: "32px" }}>
        <h2>取得したメール一覧 ({emails.length})</h2>
        {emails.length === 0 ? (
          <p>まだ取得したメールがありません。</p>
        ) : (
          emails.map((email) => (
            <div
              key={email.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "16px",
                marginBottom: "16px",
                background: "#fff",
              }}
            >
              <h3>{email.subject || "件名なし"}</h3>
              <p>
                <strong>作業日:</strong> {email.workDate || "-"}
              </p>
              <p>
                <strong>詳細現場名:</strong> {email.workPlace || "-"}
              </p>
              <p>
                <strong>始業時刻:</strong> {email.startTime || "-"} <strong>終業時刻:</strong> {email.endTime || "-"}
              </p>
              <p>
                <strong>食事時間:</strong> {email.mealTime || "-"}
              </p>
              <p>
                <strong>実働時間:</strong> {email.workHours != null ? `${email.workHours}h` : "-"}
              </p>
              <p>
                <strong>顧客名称:</strong> {email.customer || "-"}
              </p>
              <p>
                <strong>現場人数:</strong> {email.workers || "-"}
              </p>
              <p>
                <strong>残業:</strong> {email.overtime || "-"}
              </p>
              <p>
                <strong>集合場所名称:</strong> {email.meetingPlace || "-"}
              </p>
              {email.body && (
                <details style={{ marginTop: "12px" }}>
                  <summary>本文（展開）</summary>
                  <pre style={{ whiteSpace: "pre-wrap", marginTop: "8px" }}>
                    {email.body}
                  </pre>
                </details>
              )}
            </div>
          ))
        )}
      </section>

      <section style={{ marginTop: "32px" }}>
        <h2>ログ</h2>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#f9f9f9",
            padding: "16px",
            borderRadius: "8px",
            minHeight: "150px",
            maxHeight: "320px",
            overflow: "auto",
          }}
        >
          {logs.join("\n")}
        </pre>
      </section>
    </div>
  );
}

export default App;