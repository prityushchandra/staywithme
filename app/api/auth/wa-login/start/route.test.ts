import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { startWaLogin } from "@/lib/wa-login";

vi.mock("@/lib/wa-login", () => ({
  startWaLogin: vi.fn(async () => ({ token: "test-browser-token", code: "K7M2QX" })),
}));

vi.mock("@/lib/settings", () => ({
  getPlatformSettings: vi.fn(async () => ({ whatsappNumber: "+919113805548" })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function request() {
  return new Request("http://localhost/api/auth/wa-login/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+919876543210" }),
  });
}

describe("WhatsApp login destination", () => {
  it("keeps verification on the registered bot, separate from guest support and admin", async () => {
    vi.stubEnv("GUPSHUP_SOURCE", "917317666547");
    vi.stubEnv("ADMIN_PHONE", "+918789194107");

    const response = await POST(request());
    const body = await response.json();
    const link = new URL(body.waLink);

    expect(response.status).toBe(200);
    expect(startWaLogin).toHaveBeenCalledWith("+919876543210");
    expect(body.botNumber).toBe("917317666547");
    expect(link.pathname).toBe("/917317666547");
    expect(link.searchParams.get("text")).toBe("Verify my StayWithMe login: K7M2QX");
  });

  it("uses the updated guest contact only for the existing unconfigured-bot fallback", async () => {
    vi.stubEnv("GUPSHUP_SOURCE", "");
    vi.stubEnv("ADMIN_PHONE", "+918789194107");

    const response = await POST(request());
    const body = await response.json();

    expect(body.botNumber).toBe("+919113805548");
    expect(new URL(body.waLink).pathname).toBe("/919113805548");
  });
});
