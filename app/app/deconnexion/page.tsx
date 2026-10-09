import SessionReset from "@/components/session-reset";

// Recovery must render without reading the current session or the database.
export default function LogoutPage() {
  return <SessionReset />;
}
