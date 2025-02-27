import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Chatbot from './Chatbot'
import { v4 as uuidv4 } from 'uuid'

const generated_uuid: string = uuidv4();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Chatbot generated_uuid={generated_uuid} />
  </StrictMode>,
)
