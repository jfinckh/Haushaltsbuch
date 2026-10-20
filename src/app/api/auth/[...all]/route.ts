import { authServer } from "@/config/auth";

export const { GET, POST, PATCH, PUT, DELETE } = authServer.handler;
