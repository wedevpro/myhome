import AuthForm from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm/>;
}
