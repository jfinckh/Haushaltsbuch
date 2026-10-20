import { z } from "zod";

// Shared by the forms (client) and the auth endpoints (server).

export const signInSchema = z.object({
  email: z.email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter your password."),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(100, "Name is too long."),
  email: z.email("Please enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be at most 128 characters."),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
