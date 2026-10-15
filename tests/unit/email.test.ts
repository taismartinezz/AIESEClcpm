import { describe, it, expect } from "vitest";
import { escapeHtml, buildInviteEmail, buildTaskAssignedEmail, buildLabWinEmail } from "@/lib/email";

describe("escapeHtml", () => {
  it("escapes < > & \" '", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
    expect(escapeHtml("O'Malley & Associates")).toBe("O&#39;Malley &amp; Associates");
  });

  it("leaves safe text unchanged", () => {
    expect(escapeHtml("Hello, world!")).toBe("Hello, world!");
  });
});

describe("email templates — XSS injection", () => {
  const xss = '<script>alert("xss")</script>';
  const href = '<a href="javascript:alert(1)">click</a>';

  it("buildInviteEmail escapes all user-controlled fields", () => {
    const payload = buildInviteEmail({
      to: "victim@example.com",
      labName: xss,
      inviterName: xss,
      role: href,
      inviteCode: "SAFE-CODE",
    });
    expect(payload.html).not.toContain("<script");
    expect(payload.html).not.toContain('href="javascript:');
    expect(payload.html).toContain("&lt;script&gt;");
    expect(payload.html).toContain("&quot;");
  });

  it("buildTaskAssignedEmail escapes taskTitle, assignerName, projectName", () => {
    const payload = buildTaskAssignedEmail({
      to: "victim@example.com",
      recipientName: xss,
      taskTitle: xss,
      assignerName: href,
      projectName: xss,
    });
    expect(payload.html).not.toContain("<script");
    expect(payload.html).not.toContain('href="javascript:');
    expect(payload.html).toContain("&lt;script&gt;");
  });

  it("buildLabWinEmail escapes content, posterName, projectName", () => {
    const payload = buildLabWinEmail({
      to: "victim@example.com",
      recipientName: "Alice",
      posterName: xss,
      content: href,
      projectName: xss,
    });
    expect(payload.html).not.toContain("<script");
    expect(payload.html).not.toContain('href="javascript:');
    expect(payload.html).toContain("&lt;a href=");
  });

  it("invite URL is built from APP_URL + encodeURIComponent(code), not caller-supplied URL", () => {
    const payload = buildInviteEmail({
      to: "victim@example.com",
      labName: "Lab",
      inviterName: "PI",
      role: "Researcher",
      inviteCode: 'CODE"><script>alert(1)</script>',
    });
    expect(payload.html).not.toContain("<script>");
    // The encoded code should appear, not raw angle brackets
    expect(payload.html).toContain("CODE%22%3E");
  });
});
