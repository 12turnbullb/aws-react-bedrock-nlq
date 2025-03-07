import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './Chatbot.css'; 
import loadingGif from './assets/loading-gif.gif';
import botAvatar from './assets/bot-avatar.png';
import { Authenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import "@aws-amplify/ui-react/styles.css";
import { postMessage } from "./api";

Amplify.configure({
  Auth:{
    Cognito: {
      userPoolClientId: import.meta.env.VITE_CLIENT_ID,
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
    }
  }
});

export const apiEndpoint = import.meta.env.VITE_API_ENDPOINT; 

interface Message {
  sender: 'user' | 'bot';
  text: string;
  sql?: string;
}

interface AgentProps {
  generated_uuid: string;
}

interface MessageRequest {
  message: string;
  id: string; 
}

const Agent: React.FC<AgentProps> = ({ generated_uuid }) => {
    
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [expandedIndexes, setExpandedIndexes] = useState<number[]>([]);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (input.trim() === '') return;

    // Add user message to chat history
    const newMessages: Message[] = [...messages, { sender: 'user', text: input }];
    setMessages(newMessages);
    setIsLoading(true);
    setInput('');

    try {
      const data: MessageRequest = {
        message: input,
        id: generated_uuid
      };
    
      const response = await postMessage(data); // API call
    
      const botMessage: Message = {
        sender: 'bot',
        text: response.answer,
        sql: response.sql_query,
      };
    
      setMessages((prevMessages) => [...prevMessages, botMessage]);
    
    } catch (error: any) {
      
      console.error("Chatbot Error:", error.message);
    
      const botErrorMessage: Message = {
        sender: 'bot',
        text: error.message || "Something went wrong. Please try again.",
        sql: "",
      };
    
      setMessages((prevMessages) => [...prevMessages, botErrorMessage]);
    
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [messages]);

  const toggleExpand = (index: number) => {
    setExpandedIndexes((prev) =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };
  
  return (
    <Authenticator>
      {({ signOut, user }) => (
    <div className = "page-container">
      
      <div className="button-group">
        <button className="styled-button" onClick={() => window.location.reload()}>Refresh</button>
        <h3>Welcome, {user?.username}!</h3>
        <button className="styled-button" onClick={signOut}>Sign Out</button>
      </div>
      <div className = "chatbot-container">
        <div className="left-section">
          <section className="about-section">
            <h1 className="about-header">About this Demo</h1>
            <p className="description">
              We use Amazon Bedrock to generate SQL queries from natural
              language and return the results conversationally. You can ask questions
              about campaigns, donations and donors from the sample data in this demo.
            </p>
            <h2 className="about-header">Dataset Descriptions</h2>
            <p className="description">
              This application utilizes several synthetic datasets to simulate a donor data store:
            </p>
            <ul className="about-dataset-list">
              <li>
                <strong>Donations:</strong> Transactions including donation amount across various fundraising events. 
              </li>
              <li>
                <strong>Donors:</strong> Details from donor profiles including email, phone and address. 
              </li>
              <li>
                <strong>Events:</strong> Details about fundraising events including name, date, location and type. 
              </li>
              <li>
                <strong>Campaigns:</strong> Details about fundraising campaigns including start date, end data and target amount. 
              </li>
              <li>
                <strong>Dates:</strong> Lookup table for campaign and event dates. 
              </li>
              <li>
                <strong>Payment Method:</strong> Details about donor payment methods. 
              </li>
            </ul>
          </section>
        </div>
        <div className="right-section">
      <div className="chatbot-overlay">
        <div className="chatbot-title">Amazon Bedrock Natural Language Query</div>
        <div className="chat-container">
          <div className="chat-history" ref={chatHistoryRef}>
            {messages.map((message, index) => (
              <div key={index} className={`message ${message.sender}`}>
                {message.sender === 'bot' ? (
                  <div className="bot-message">
                    <img
                      src={botAvatar}
                      alt="Bot Avatar"
                      className="avatar"
                    />
                    <div className="text-bubble bot">
                      <div className="markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                      </div>
                      {message.sql && (
                        <div className="expandable-section">
                          <button className="expand-button" onClick={() => toggleExpand(index)}>
                            {expandedIndexes.includes(index) ? 'Hide SQL' : 'Show SQL'}
                          </button>
                          {expandedIndexes.includes(index) && (
                            <div className="sql-query">
                              <div>{message.sql}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="user-message">
                    <div className="text-bubble user">{message.text}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="form">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="input"
              disabled={isLoading}
            />
            {isLoading ? (
              <div className="button-loading">
                <img src={loadingGif} alt="Loading" className="loading-gif" />
              </div>
            ) : (
              <button type="submit" className="button">Send</button>
            )}
          </form>
        </div>
      </div>
      </div>
      </div>
    </div>
    )}
    </Authenticator>
  );
};

export default Agent;