import { redirect } from "next/navigation";

// The listings list now lives on the host dashboard.
export default function HostListingsRedirect() {
  redirect("/host");
}
