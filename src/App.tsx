import { useState, useEffect } from "react";
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
  workAddress?: string;
  notes?: string;
  calendarEventId?: string;
};

type Tab = "home" | "settings";

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

function parseWorkDate(input: string): Date | undefined {
  const raw = input.trim().replace(/\s+/g, "").replace(/[年月]/g, "/").replace(/日$/, "");
  const datePatterns = [
    /^(\d{4})[/-]?(\d{1,2})[/-]?(\d{1,2})$/,
    /^(\d{1,2})[/-]?(\d{1,2})$/,
  ];

  for (const pattern of datePatterns) {
    const match = raw.match(pattern);
    if (!match) continue;

    if (match.length === 4) {
      const [, y, m, d] = match;
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      return isNaN(date.getTime()) ? undefined : date;
    }

    if (match.length === 3) {
      const [, m, d] = match;
      const now = new Date();
      const date = new Date(now.getFullYear(), Number(m) - 1, Number(d));
      return isNaN(date.getTime()) ? undefined : date;
    }
  }

  return undefined;
}

function parseTime(time?: string) {
  if (!time) return undefined;
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

function formatDateISO(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildEventDateTime(date: Date, time: string, timeZone: string) {
  const parsed = parseTime(time);
  if (!parsed) return undefined;
  const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), parsed.hours, parsed.minutes);
  return {
    dateTime: eventDate.toISOString(),
    timeZone,
  };
}

function App() {
  const [emails, setEmails] = useState<ParsedEmail[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const storedEmails = localStorage.getItem("shift-income-emails");
      return storedEmails ? JSON.parse(storedEmails) : [];
    } catch {
      return [];
    }
  });
  const [logs, setLogs] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const storedLogs = localStorage.getItem("shift-income-logs");
      return storedLogs ? JSON.parse(storedLogs) : [];
    } catch {
      return [];
    }
  });
  const [hourlyRate, setHourlyRate] = useState<number>(() => {
    if (typeof window === "undefined") return 1300;
    try {
      const value = Number(localStorage.getItem("shift-income-hourly-rate"));
      return !isNaN(value) && value > 0 ? value : 1300;
    } catch {
      return 1300;
    }
  });
  const [transportCost, setTransportCost] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const value = Number(localStorage.getItem("shift-income-transport-cost"));
      return !isNaN(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  });
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem("shift-income-emails", JSON.stringify(emails));
      localStorage.setItem("shift-income-logs", JSON.stringify(logs));
      localStorage.setItem("shift-income-hourly-rate", String(hourlyRate));
      localStorage.setItem("shift-income-transport-cost", String(transportCost));
    } catch {
      // localStorage が使えない場合は無視
    }
  }, [emails, logs, hourlyRate, transportCost]);

  const appendLog = (message: string) => {
    setLogs((prev) => [...prev, message]);
    console.log(message);
  };

  const login = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events",

    onSuccess: async (tokenResponse) => {
      setLoading(true);
      setError(undefined);
      setRegisterMessage(undefined);
      setAccessToken(tokenResponse.access_token);
      setLogs([]);

      appendLog("ログイン成功");

      const savedEmails: ParsedEmail[] = (() => {
        if (typeof window === "undefined") return [];
        try {
          const stored = localStorage.getItem("shift-income-emails");
          return stored ? JSON.parse(stored) as ParsedEmail[] : [];
        } catch {
          return [];
        }
      })();
      const savedEventIds = new Map<string, string | undefined>(
        savedEmails.map((email) => [email.id, email.calendarEventId])
      );

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
            const workAddress = decodedBody ? getValue(decodedBody, "現場住所") : undefined;
            const notes = decodedBody ? getValue(decodedBody, "伝達事項") : undefined;
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
              workAddress,
              notes,
              calendarEventId: savedEventIds.get(message.id),
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

  const createCalendarEvent = async (email: ParsedEmail): Promise<string | undefined> => {
    if (!accessToken) {
      throw new Error("Google カレンダーに接続されていません。");
    }

    if (!email.workDate) {
      throw new Error("作業日がありません。イベント登録できませんでした。");
    }

    const eventDate = parseWorkDate(email.workDate);
    if (!eventDate) {
      throw new Error("作業日の形式を解析できませんでした。"
      );
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    let start: Record<string, string> = {};
    let end: Record<string, string> = {};

    if (email.startTime && email.endTime) {
      const startDateTime = buildEventDateTime(eventDate, email.startTime, timeZone);
      const endDateTime = buildEventDateTime(eventDate, email.endTime, timeZone);
      if (startDateTime && endDateTime) {
        start = { dateTime: startDateTime.dateTime, timeZone: startDateTime.timeZone };
        end = { dateTime: endDateTime.dateTime, timeZone: endDateTime.timeZone };
      }
    }

    if (!start.dateTime || !end.dateTime) {
      const nextDay = new Date(eventDate);
      nextDay.setDate(nextDay.getDate() + 1);
      start = { date: formatDateISO(eventDate) };
      end = { date: formatDateISO(nextDay) };
    }

    const descriptionItems = [
      email.notes ? `伝達事項: ${email.notes}` : undefined,
      email.customer ? `顧客名称: ${email.customer}` : undefined,
      email.body ? `\n---\n${email.body}` : undefined,
    ].filter(Boolean);

    const eventBody = {
      summary: email.workPlace || email.subject || "作業予定",
      location: email.workAddress || email.meetingPlace || undefined,
      description: descriptionItems.join("\n"),
      start,
      end,
    };

    try {
      appendLog(`イベント作成リクエスト: ${email.id} - ${eventBody.summary}`);
      const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      });

      const result = await response.json();
      appendLog(`Google API レスポンス(status=${response.status}): ${JSON.stringify(result)}`);

      if (!response.ok) {
        throw new Error(result.error?.message || `Google カレンダーへの登録に失敗しました。(status=${response.status})`);
      }

      return result.id;
    } catch (err) {
      appendLog(`createCalendarEvent エラー (${email.id}): ${err}`);
      throw err;
    }
  };

  const registerCalendarEvents = async () => {
    setError(undefined);
    setRegisterMessage(undefined);
    appendLog("registerCalendarEvents 開始");

    if (!accessToken) {
      setError("Gmail に接続して Google カレンダー権限を許可してください。");
      return;
    }

    if (emails.length === 0) {
      setError("登録するメールがありません。");
      return;
    }

    setRegistering(true);
    const updatedEmails = [...emails];
    let registeredCount = 0;

    const checkEventExists = async (eventId: string | undefined) => {
      if (!eventId) return false;
      if (!accessToken) return false;
      try {
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          if (res.status === 404 || res.status === 410) {
            appendLog(`イベント確認: ${eventId} は見つかりません (status=${res.status})`);
            return false;
          }
          appendLog(`イベント確認で非OKステータス: ${res.status}`);
          return false;
        }
        const data = await res.json();
        if (data?.status === "cancelled") {
          appendLog(`イベント確認: ${eventId} はキャンセル済みです`);
          return false;
        }
        return true;
      } catch (err) {
        appendLog(`イベント確認エラー: ${err}`);
        return false;
      }
    };

    const findExistingEvent = async (email: ParsedEmail) => {
      if (!accessToken || !email.workDate) return undefined;
      const eventDate = parseWorkDate(email.workDate);
      if (!eventDate) return undefined;

      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      // time window: whole day
      const dayStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), 0, 0).toISOString();
      const dayEnd = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate() + 1, 0, 0).toISOString();

      const q = encodeURIComponent((email.workPlace || email.subject || "").slice(0, 250));
      try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(dayStart)}&timeMax=${encodeURIComponent(dayEnd)}&q=${q}&singleEvents=true`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return undefined;
        const data = await res.json();
        if (!data.items || data.items.length === 0) return undefined;
        // try to find best match: exact summary
        const summaryTarget = (email.workPlace || email.subject || "").trim();
        for (const item of data.items) {
          if ((item.summary || "").trim() === summaryTarget) return item.id;
        }
        // fallback: return first item
        return data.items[0].id;
      } catch (err) {
        appendLog(`既存イベント検索エラー: ${err}`);
        return undefined;
      }
    };

    for (let i = 0; i < updatedEmails.length; i += 1) {
      const email = updatedEmails[i];

      appendLog(`処理中メール: ${email.id} calendarEventId=${email.calendarEventId}`);
      if (email.calendarEventId) {
        // イベントが実際に存在するか確認。存在すればスキップ、404なら再登録検討
        const exists = await checkEventExists(email.calendarEventId);
        if (exists) {
          appendLog(`イベント存在: ${email.calendarEventId} を確認。スキップします`);
          continue;
        }
        appendLog(`既存イベントが見つかりません（削除済み）: ${email.workPlace || email.subject}`);
        updatedEmails[i] = { ...email, calendarEventId: undefined };
      }

      // 同じ日付・タイトルで既にカレンダーに存在するイベントがないか検索
      try {
        const foundId = await findExistingEvent(updatedEmails[i]);
        appendLog(`findExistingEvent result for ${updatedEmails[i].id}: ${foundId}`);
        if (foundId) {
          updatedEmails[i] = { ...updatedEmails[i], calendarEventId: foundId };
          appendLog(`カレンダー上で既存イベントを発見しました: ${updatedEmails[i].workPlace || updatedEmails[i].subject}`);
          continue;
        }
      } catch (err) {
        appendLog(`既存イベント検索失敗: ${err}`);
      }

      try {
        const eventId = await createCalendarEvent(updatedEmails[i]);
        appendLog(`createCalendarEvent returned: ${eventId}`);
        if (eventId) {
          updatedEmails[i] = { ...updatedEmails[i], calendarEventId: eventId };
          registeredCount += 1;
          appendLog(`Googleカレンダーに登録しました: ${updatedEmails[i].workPlace || updatedEmails[i].subject}`);
        }
      } catch (createError) {
        appendLog(`イベント登録に失敗しました (${updatedEmails[i].subject || updatedEmails[i].id}): ${createError}`);
      }
    }

    setEmails(updatedEmails);
    setRegistering(false);

    if (registeredCount > 0) {
      setRegisterMessage(`${registeredCount} 件を Google カレンダーに登録しました。`);
    } else {
      setRegisterMessage("新規登録するイベントはありませんでした。");
    }
  };

  return (
    <div className="app-root">
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.03em" }}>Shift Income Manager</h1>
            <p style={{ margin: "8px 0 0", color: "#475569" }}>メールから予定情報を抽出し、Google カレンダーに自動登録できます。</p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {(["home", "settings"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "10px 18px",
                  background: activeTab === tab ? "#1d4ed8" : "#fff",
                  color: activeTab === tab ? "#fff" : "#0f172a",
                  border: activeTab === tab ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                  borderRadius: "999px",
                  cursor: "pointer",
                  boxShadow: activeTab === tab ? "0 16px 32px rgba(59,130,246,0.12)" : "0 8px 16px rgba(15,23,42,0.04)",
                  transition: "transform 0.2s, background 0.2s",
                }}
                onMouseEnter={(event) => {
                  (event.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(event) => {
                  (event.currentTarget as HTMLButtonElement).style.transform = "none";
                }}
              >
                {tab === "home" ? "ホーム" : "設定"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: "16px", color: "#d32f2f" }}>
          {error}
        </div>
      )}

      {activeTab === "home" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
            <button
              onClick={() => login()}
              disabled={loading}
              style={{
                padding: "12px 20px",
                fontSize: "16px",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)",
                boxShadow: "0 16px 32px rgba(56,189,248,0.18)",
                cursor: "pointer",
              }}
            >
              {loading ? "読み込み中..." : "Gmailに接続"}
            </button>
            <button
              onClick={registerCalendarEvents}
              disabled={loading || registering || emails.length === 0}
              style={{
                padding: "12px 20px",
                fontSize: "16px",
                color: "#0f172a",
                border: "1px solid #cbd5e1",
                borderRadius: "12px",
                background: "#fff",
                boxShadow: "0 10px 20px rgba(15,23,42,0.06)",
                cursor: "pointer",
              }}
            >
              {registering ? "登録中..." : "カレンダーに登録"}
            </button>
          </div>
          {registerMessage && (
            <div style={{ marginTop: "16px", color: "#1e3a8a" }}>
              {registerMessage}
            </div>
          )}

          <section style={{ marginTop: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <h2 style={{ margin: 0 }}>取得したメール一覧</h2>
              <span style={{ color: "#475569", fontSize: "0.95rem" }}>{emails.length} 件</span>
            </div>
            {emails.length === 0 ? (
              <p style={{ color: "#475569", marginTop: "16px" }}>まだ取得したメールがありません。</p>
            ) : (
              emails.map((email) => (
                <div
                  key={email.id}
                  style={{
                    border: "1px solid rgba(148,163,184,0.35)",
                    borderRadius: "18px",
                    padding: "20px",
                    marginBottom: "18px",
                    background: "rgba(255,255,255,0.96)",
                    boxShadow: "0 14px 30px rgba(15,23,42,0.08)",
                  }}
                >
                  <h3 style={{ margin: "0 0 10px", color: "#0f172a" }}>{email.subject || "件名なし"}</h3>
                  <p style={{ margin: "4px 0", color: "#334155" }}>
                    <strong>作業日:</strong> {email.workDate || "-"}
                  </p>
                  <p style={{ margin: "4px 0", color: "#334155" }}>
                    <strong>詳細現場名:</strong> {email.workPlace || "-"}
                  </p>
                  <p style={{ margin: "4px 0", color: "#334155" }}>
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
                  <p>
                    <strong>現場住所:</strong> {email.workAddress || "-"}
                  </p>
                  <p>
                    <strong>伝達事項:</strong> {email.notes || "-"}
                  </p>
                  <p style={{ margin: "4px 0", color: "#0f172a", fontWeight: 700 }}>
                    {email.calendarEventId ? "Google カレンダー登録済み" : "未登録"}
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

          <section style={{ marginTop: "32px", padding: "24px", borderRadius: "24px", background: "rgba(255,255,255,0.75)", boxShadow: "0 24px 60px rgba(15,23,42,0.08)", border: "1px solid rgba(148,163,184,0.24)" }}>
            <h2 style={{ marginTop: 0 }}>ログ</h2>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#f8fafc",
                padding: "18px",
                borderRadius: "16px",
                minHeight: "150px",
                maxHeight: "320px",
                overflow: "auto",
                color: "#334155",
                border: "1px solid rgba(148,163,184,0.3)",
              }}
            >
              {logs.join("\n")}
            </pre>
          </section>
        </>
      )}

      {activeTab === "settings" && (
        <section style={{ marginTop: "32px", padding: "24px", borderRadius: "24px", background: "rgba(255,255,255,0.96)", boxShadow: "0 24px 60px rgba(15,23,42,0.08)", border: "1px solid rgba(148,163,184,0.24)" }}>
          <h2 style={{ marginTop: 0 }}>設定</h2>
          <div style={{ maxWidth: "420px", marginTop: "24px" }}>
            <label style={{ display: "block", marginBottom: "18px" }}>
              <div style={{ marginBottom: "8px", fontWeight: "700", color: "#0f172a" }}>時給</div>
              <input
                type="number"
                value={hourlyRate}
                min={0}
                onChange={(event) => setHourlyRate(Number(event.target.value) || 0)}
                style={{ width: "100%", padding: "14px 16px", borderRadius: "16px", border: "1px solid rgba(148,163,184,0.35)", background: "#f8fafc", color: "#0f172a" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: "18px" }}>
              <div style={{ marginBottom: "8px", fontWeight: "700", color: "#0f172a" }}>交通費 (円)</div>
              <input
                type="number"
                value={transportCost}
                min={0}
                step={1}
                onChange={(event) => setTransportCost(Number(event.target.value) || 0)}
                style={{ width: "100%", padding: "14px 16px", borderRadius: "16px", border: "1px solid rgba(148,163,184,0.35)", background: "#f8fafc", color: "#0f172a" }}
              />
            </label>
            <p style={{ color: "#475569", lineHeight: "1.8", margin: 0 }}>
              カレンダーに表示する金額は 「実働時間 × 時給 ＋ 交通費(円)」です。交通費は固定額で加算されます。
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

export default App;