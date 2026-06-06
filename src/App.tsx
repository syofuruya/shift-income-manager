import { useGoogleLogin } from "@react-oauth/google";

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

function App() {
  const login = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/gmail.readonly",

    onSuccess: async (tokenResponse) => {
      console.log("ログイン成功");

      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=subject:作業確認",
        {
          headers: {
            Authorization: `Bearer ${tokenResponse.access_token}`,
          },
        }
      );

      const data = await response.json();

      console.log("作業確認メール一覧");
      console.log(data);

      if (!data.messages || data.messages.length === 0) {
        console.log("作業確認メールが見つかりません");
        return;
      }

      const messageId = data.messages[0].id;

      const mailResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${tokenResponse.access_token}`,
          },
        }
      );

      const mailData = await mailResponse.json();

      const subject = mailData.payload.headers.find(
        (header: any) => header.name === "Subject"
      );

      console.log("件名");
      console.log(subject?.value);

      if (mailData.payload.body?.data) {
        const decodedBody = decodeURIComponent(
          escape(
            atob(
              mailData.payload.body.data
                .replace(/-/g, "+")
                .replace(/_/g, "/")
            )
          )
        );

        console.log("本文");
        console.log(decodedBody);

        const workDate = getValue(decodedBody, "作業日");
        const workPlace = getValue(decodedBody, "詳細現場名");
        const startTime = getValue(decodedBody, "始業時刻");
        const endTime = getValue(decodedBody, "終業時刻");
        const customer = getValue(decodedBody, "顧客名称");
        const workers = getValue(decodedBody, "現場人数");
        const overtime = getValue(decodedBody, "残業");
        const meetingPlace = getValue(decodedBody, "集合場所名称");
        const mealTime = getValue(decodedBody, "食事時間");

        const workHours = calcWorkHours(
          startTime,
          endTime,
          mealTime
        );

        console.log("抽出結果");

        console.log({
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
        });
      } else {
        console.log("本文が見つかりません");
      }
    },

    onError: () => {
      console.log("ログイン失敗");
    },
  });

  return (
    <div style={{ padding: "40px" }}>
      <h1>Shift Income Manager</h1>

      <button onClick={() => login()}>
        Gmailに接続
      </button>
    </div>
  );
}

export default App;