import { logInfo } from "../utils/logger";

interface UserRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

const users: UserRow[] = [
  { id: "u-1", name: "Ana", email: "ana@example.com", passwordHash: "h6" }
];

export async function queryUser(id: string): Promise<UserRow> {
  logInfo(`queryUser(${id})`);
  return users.find(user => user.id === id) ?? users[0];
}

export async function queryPasswordHash(id: string): Promise<string> {
  logInfo(`queryPasswordHash(${id})`);
  return (users.find(user => user.id === id) ?? users[0]).passwordHash;
}
