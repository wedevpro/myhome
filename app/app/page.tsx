import HomeApp from "@/components/home-app";
import { getCurrentUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getCurrentUser();
  return <HomeApp user={user} />;
}
