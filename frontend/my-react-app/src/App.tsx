import { useState } from 'react'
import './App.css'
import { Authenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import "@aws-amplify/ui-react/styles.css";
import { getTime } from "./api";


Amplify.configure({
  Auth:{
    Cognito: {
      userPoolClientId: "5vgg1sato96m7fkr7beddk2amb",
      userPoolId: "us-east-1_3WqN5CLia",
    }
  }
});

export const apiEndpoint = "https://2v1k4dgpfl.execute-api.us-east-1.amazonaws.com"; // Please change this value.

function App() {

  const [serverTime, setServerTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTime = async () => {
    setLoading(true);
    setError(null); // Clear previous errors

    try {
      const data = await getTime();
      setServerTime(data.cur_date); // Assuming API response has "cur_date"
    } catch (err) {
      setError("Failed to fetch time. Check API configuration.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };


  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1>Welcome, {user?.username}!</h1>
          <button onClick={signOut}>Sign Out</button>

          <div style={{ marginTop: "20px" }}>
            <button onClick={fetchTime} disabled={loading}>
              {loading ? "Fetching Time..." : "Get Server Time"}
            </button>

            {serverTime && <p>Server Time: {serverTime}</p>}
            {error && <p style={{ color: "red" }}>{error}</p>}
          </div>
        </div>
      )}
    </Authenticator>
  )
}

export default App
