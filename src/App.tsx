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
};

type Tab = "home" | "calendar" | "settings";

type WorkDateSummary = {
  hours: number;
  pay: number;
  places: string[];
  emails: ParsedEmail[];
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

const weekDayNames = ["日", "月", "火", "水", "木", "金", "土"];

function getCalendarCells(target: Date) {
  const year = target.getFullYear();
  const month = target.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeek = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startWeek + daysInMonth) / 7) * 7;
  const cells: { label: string; currentMonth: boolean; dayNumber: number }[] = [];

  for (let i = 0; i < totalCells; i += 1) {
    const dayNumber = i - startWeek + 1;
    if (dayNumber <= 0) {
      cells.push({
        label: String(daysInPrevMonth + dayNumber),
        currentMonth: false,
        dayNumber: dayNumber,
      });
    } else if (dayNumber > daysInMonth) {
      cells.push({
        label: String(dayNumber - daysInMonth),
        currentMonth: false,
        dayNumber: dayNumber,
      });
    } else {
      cells.push({
        label: String(dayNumber),
        currentMonth: true,
        dayNumber: dayNumber,
      });
    }
  }

  return cells;
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
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const workDateSummary = emails.reduce<Record<string, WorkDateSummary>>((acc, email) => {
    if (!email.workDate || email.workHours == null) return acc;
    const parsed = parseWorkDate(email.workDate);
    if (!parsed) return acc;

    const key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    const amount = email.workHours * hourlyRate + transportCost;

    if (!acc[key]) {
      acc[key] = { hours: 0, pay: 0, places: [], emails: [] };
    }

    acc[key].hours += email.workHours;
    acc[key].pay += amount;

    if (email.workPlace && !acc[key].places.includes(email.workPlace)) {
      acc[key].places.push(email.workPlace);
    }

    acc[key].emails.push(email);
    return acc;
  }, {});

  const calendarYear = calendarDate.getFullYear();
  const calendarMonth = calendarDate.getMonth();
  const calendarToday = new Date();
  const calendarCells = getCalendarCells(calendarDate);
  const calendarMonthKeys = Object.keys(workDateSummary).filter((key) => {
    const [y, m] = key.split("-").map((value) => Number(value));
    return y === calendarYear && m - 1 === calendarMonth;
  });
  const calendarMonthlyTotal = calendarMonthKeys.reduce((sum, key) => sum + (workDateSummary[key]?.pay || 0), 0);

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
    <div style={{ minHeight: "100vh", padding: "32px 24px 48px", fontFamily: "Inter, system-ui, sans-serif", color: "#102a43", background: "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.03em" }}>Shift Income Manager</h1>
            <p style={{ margin: "8px 0 0", color: "#475569" }}>メールから給与情報を抽出し、カレンダーで月間集計できます。</p>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {(["home", "calendar", "settings"] as Tab[]).map((tab) => (
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
                {tab === "home" ? "ホーム" : tab === "calendar" ? "カレンダー" : "設定"}
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
          <button
            onClick={() => login()}
            disabled={loading}
            style={{
              padding: "12px 20px",
              fontSize: "16px",
              marginTop: "24px",
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

      {activeTab === "calendar" && (
        <section style={{ marginTop: "32px", padding: "24px", borderRadius: "24px", background: "rgba(255,255,255,0.96)", boxShadow: "0 24px 60px rgba(15,23,42,0.08)", border: "1px solid rgba(148,163,184,0.24)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h2 style={{ margin: 0 }}>カレンダー</h2>
              <div style={{ color: "#475569", marginTop: "6px" }}>
                {calendarYear}年 {calendarMonth + 1}月
              </div>
              <div style={{ marginTop: "10px", color: "#0f172a", fontWeight: 700, fontSize: "1.05rem" }}>
                合計: ¥{Math.round(calendarMonthlyTotal)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setCalendarDate(new Date(calendarYear, calendarMonth - 1, 1));
                  setSelectedDateKey(null);
                }}
                style={{ padding: "10px 14px", borderRadius: "12px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", boxShadow: "0 10px 20px rgba(15,23,42,0.06)" }}
              >
                前月
              </button>
              <button
                onClick={() => {
                  setCalendarDate(new Date(calendarYear, calendarMonth + 1, 1));
                  setSelectedDateKey(null);
                }}
                style={{ padding: "10px 14px", borderRadius: "12px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", boxShadow: "0 10px 20px rgba(15,23,42,0.06)" }}
              >
                次月
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px", marginTop: "18px" }}>
            {weekDayNames.map((name) => (
              <div
                key={name}
                style={{
                  textAlign: "center",
                  padding: "10px 0",
                  background: "#f8fafc",
                  borderRadius: "10px",
                  fontWeight: "700",
                  color: "#334155",
                  boxShadow: "inset 0 -1px 0 rgba(148,163,184,0.2)",
                }}
              >
                {name}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginTop: "4px" }}>
            {calendarCells.map((cell, index) => {
              const cellDay = Number(cell.label);
              const cellDate = new Date(calendarYear, calendarMonth, cellDay);
              const isToday =
                cell.currentMonth &&
                calendarToday.getFullYear() === calendarYear &&
                calendarToday.getMonth() === calendarMonth &&
                cellDay === calendarToday.getDate();
              const key = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, "0")}-${String(cellDate.getDate()).padStart(2, "0")}`;
              const summary = cell.currentMonth ? workDateSummary[key] : undefined;
              const isSelected = selectedDateKey === key;

              return (
                <div
                  key={`${cell.label}-${index}`}
                  onClick={() => {
                    if (cell.currentMonth) {
                      setSelectedDateKey(summary ? key : null);
                    }
                  }}
                  style={{
                    minHeight: "82px",
                    padding: "14px",
                    borderRadius: "16px",
                    background: isSelected ? "#dbeafe" : cell.currentMonth ? "#ffffff" : "#eef2ff",
                    color: cell.currentMonth ? "#0f172a" : "#94a3b8",
                    border: isToday ? "2px solid #2563eb" : "1px solid rgba(148,163,184,0.3)",
                    textAlign: "right",
                    position: "relative",
                    cursor: cell.currentMonth ? "pointer" : "default",
                    boxShadow: isSelected ? "0 18px 40px rgba(37,99,235,0.12)" : "none",
                    transition: "transform 0.2s, box-shadow 0.2s",
                  }}
                >
                  <div style={{ fontSize: "14px", fontWeight: isToday ? "700" : "400" }}>
                    {cell.label}
                  </div>
                  {summary && (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: "#1976d2", textAlign: "left" }}>
                      <div>{summary.hours.toFixed(1)}h</div>
                      <div>¥{Math.round(summary.pay)}</div>
                      <div style={{ color: "#333" }}>{summary.places.slice(0, 2).join(" / ")}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "calendar" && selectedDateKey && workDateSummary[selectedDateKey] && (
        <section style={{ marginTop: "24px", padding: "24px", borderRadius: "24px", background: "rgba(255,255,255,0.96)", boxShadow: "0 24px 60px rgba(15,23,42,0.08)", border: "1px solid rgba(148,163,184,0.24)" }}>
          <h3 style={{ margin: 0, marginBottom: "16px" }}>詳細: {selectedDateKey}</h3>
          {workDateSummary[selectedDateKey].emails.map((email) => (
            <div
              key={email.id}
              style={{
                border: "1px solid rgba(148,163,184,0.35)",
                borderRadius: "18px",
                padding: "20px",
                marginBottom: "16px",
                background: "#fff",
                boxShadow: "0 18px 36px rgba(15,23,42,0.06)",
              }}
            >
              <div style={{ marginBottom: "10px" }}>
                <strong style={{ fontSize: "1rem", color: "#0f172a" }}>{email.subject || "件名なし"}</strong>
              </div>
              <div style={{ marginBottom: "12px", color: "#475569", lineHeight: 1.7 }}>
                <div>詳細現場名: {email.workPlace || "-"}</div>
                <div>実働時間: {email.workHours != null ? email.workHours + "h" : "-"}</div>
                <div>金額: {email.workHours != null ? "¥" + Math.round(email.workHours * hourlyRate + transportCost) : "-"}</div>
              </div>
              {email.body ? (
                <pre style={{ whiteSpace: "pre-wrap", background: "#f8fafc", padding: "16px", borderRadius: "12px", border: "1px solid rgba(148,163,184,0.25)", color: "#334155" }}>
                  {email.body}
                </pre>
              ) : (
                <p style={{ color: "#64748b" }}>本文がありません。</p>
              )}
            </div>
          ))}
        </section>
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