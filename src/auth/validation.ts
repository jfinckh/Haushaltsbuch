import { z } from "zod";

// Shared by the forms (client) and the auth endpoints (server). Messages are translation keys;
// the forms translate them.

export const signInSchema = z.object({
  email: z.email("auth.validation.emailInvalid"),
  password: z.string().min(1, "auth.validation.passwordRequired"),
});

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "auth.validation.nameRequired").max(100, "auth.validation.nameTooLong"),
  email: z.email("auth.validation.emailInvalid"),
  password: z
    .string()
    .min(8, "auth.validation.passwordTooShort")
    .max(128, "auth.validation.passwordTooLong"),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
