import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from 'fs';

/** * User Management Interface 
 * This defines the core data structure for the system.
 */
interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

export class AuthService {
  private users: User[] = [];

  constructor() {
    console.log("Auth initialized");
  }

  /** Validates if a user is an admin */
  public async isAdmin(userId: string): Promise<boolean> {
    const user = this.users.find(u => u.id === userId);
    return user?.role === 'admin';
  }
}

// Fixed: This must be OUTSIDE the class
export function startAuth() {
  return new AuthService();
}