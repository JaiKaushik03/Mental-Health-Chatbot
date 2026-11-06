export interface User {
  id: string;
  email: string | null;
  guest: boolean;
}
export interface Session {
  user: User | null;
  mode: "ai" | "demo";
}
export interface Conversation {
  id: string;
  title: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  safetyCategory: string;
  createdAt: string;
}
export interface Exchange {
  messages: Message[];
  conversation: Conversation;
}
