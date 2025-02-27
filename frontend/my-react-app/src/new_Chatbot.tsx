import { useState } from 'react';
import './new_Chatbot.css';
import './Chatbot.css'
import { Authenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import "@aws-amplify/ui-react/styles.css";
import { getTime } from "./api";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolClientId: "5vgg1sato96m7fkr7beddk2amb",
      userPoolId: "us-east-1_3WqN5CLia",
    }
  }
});

export const apiEndpoint = "https://2v1k4dgpfl.execute-api.us-east-1.amazonaws.com";

function Chatbot() {
  const [messages, setMessages] = useState<{ sender: string, text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");

  const handleUserMessage = async () => {
    if (!input.trim()) return;
    const userMessage = { sender: "User", text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    
    try {
      const data = await getTime();
      const botMessage = { sender: "Bot", text: `${data.cur_date}`, showSQL: true };
      setMessages(prev => [...prev, botMessage]);
    } catch (err) {
      const errorMessage = { sender: "Bot", text: "Failed to fetch time. Check API configuration." };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };
  

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleUserMessage();
    }
  };

  return (
    <div className="chatbot-container">
      <div className="chatbot-header">YUSA Natural Language Query</div>
      <div className="chatbot-messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.sender === "User" ? "user" : "bot"}`}>
            {msg.sender === "Bot"}
            <div className="message-text">
              {msg.text}
            </div>
          </div>
        ))}
      </div>
      <div className="chatbot-input-container">
        <input 
          type="text" 
          placeholder="Type a message..." 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          onKeyDown={handleKeyDown} 
          className="chatbot-input"
        />
        <button onClick={handleUserMessage} disabled={loading} className="chatbot-send">
          Send
        </button>
      </div>
    </div>
  );
}


function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div>
          <nav className="navbar">
            <h2>Welcome, {user?.username}!</h2>
            <button onClick={signOut} className="signout-button">Sign Out</button>
          </nav>
        <Chatbot />
        </div>
      )}
    </Authenticator>
  );
}

export default App;
