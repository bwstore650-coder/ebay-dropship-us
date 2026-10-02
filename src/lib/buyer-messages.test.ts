import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMemberMessages } from "./ebay";

type Row = Record<string, unknown>;
const mem = vi.hoisted(() => ({ msgs: [] as Row[], orders: [] as Row[], seq: 0, questions: [] as unknown[], answered: [] as unknown[], drafts: 0 }));

vi.mock("@/lib/db", () => ({
  db: {
    buyerMessage: {
      findUnique: vi.fn(async ({ where }: { where: { ebayAccountId_messageId: { ebayAccountId: string; messageId: string } } }) =>
        mem.msgs.find((m) => m.ebayAccountId === where.ebayAccountId_messageId.ebayAccountId && m.messageId === where.ebayAccountId_messageId.messageId) ?? null),
      findFirst: vi.fn(async ({ where }: { where: Row }) => mem.msgs.find((m) => m.id === where.id && m.userId === where.userId) ?? null),
      findMany: vi.fn(async ({ where, take }: { where: Row; take?: number }) => mem.msgs.filter((m) => m.userId === where.userId && m.status === where.status && m.draft === null && m.draftError === null).slice(0, take)),
      create: vi.fn(async ({ data }: { data: Row }) => { const r = { id: `M${++mem.seq}`, status: "NEW", draft: null, draftError: null, ...data }; mem.msgs.push(r); return r; }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(mem.msgs.find((m) => m.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { messageId?: { notIn: string[] }; status: string; userId: string; id?: string } ; data: Row }) => {
        const rows = mem.msgs.filter((m) => m.userId === where.userId && m.status === where.status && (!where.id || m.id === where.id) && (!where.messageId || !where.messageId.notIn.includes(m.messageId as string)));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
    order: {
      findMany: vi.fn(async ({ where }: { where: Row }) => mem.orders.filter((o) => o.buyerUsername === where.buyerUsername)),
      findFirst: vi.fn(async ({ where }: { where: Row }) => mem.orders.find((o) => o.id === where.id) ?? null),
    },
  },
}));
vi.mock("@/lib/ebay-account", () => ({ userToken: async () => "TOKEN" }));
vi.mock("@/lib/ai-quota", () => ({ takeAiCredit: vi.fn(async () => undefined), refundAiCredit: vi.fn(async () => undefined), AiLimitError: class extends Error {} }));
vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  writeBuyerReply: vi.fn(async (i: { order: { trackingNumber: string | null } | null }) => { mem.drafts++; return i.order?.trackingNumber ? `Tracking: ${i.order.trackingNumber}` : "Which order?"; }),
}));
vi.mock("@/lib/ebay", async (orig) => ({
  ...(await orig<typeof import("./ebay")>()),
  getUnansweredQuestions: vi.fn(async () => mem.questions),
  answerBuyerQuestion: vi.fn(async (_t: string, m: unknown) => { mem.answered.push(m); }),
}));

import { dismissMessage, MessageError, sendReply, syncBuyerMessages } from "./buyer-messages";

const user = { id: "U1", plan: "PRO", defaultMarketplace: "EBAY_US", ebayAccounts: [{ id: "ACC" }], supplierAccounts: [] } as never;
const q = (id: string, buyer: string, itemId = "ITEM1") => ({ messageId: id, itemId, itemTitle: "Can opener", buyer, subject: "Where is my order?", body: "Hi, where is my order?", questionType: "Shipping", receivedAt: new Date().toISOString() });

beforeEach(() => {
  Object.assign(mem, { msgs: [], orders: [], seq: 0, questions: [], answered: [], drafts: 0 });
});

describe("questions des acheteurs", () => {
  it("lecture du XML eBay", () => {
    const xml = `<GetMemberMessagesResponse><Ack>Success</Ack><MemberMessage><MemberMessageExchange><Item><ItemID>123</ItemID><Title>Can &amp; opener</Title></Item><Question><MessageType>AskSellerQuestion</MessageType><QuestionType>Shipping</QuestionType><SenderID>bob</SenderID><Subject>Order</Subject><Body>Where is it?</Body><MessageID>999</MessageID></Question><MessageStatus>Unanswered</MessageStatus><CreationDate>2026-10-01T10:00:00.000Z</CreationDate></MemberMessageExchange></MemberMessage><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult></GetMemberMessagesResponse>`;
    expect(parseMemberMessages(xml)).toEqual({ totalPages: 1, messages: [{ messageId: "999", itemId: "123", itemTitle: "Can & opener", buyer: "bob", subject: "Order", body: "Where is it?", questionType: "Shipping", receivedAt: "2026-10-01T10:00:00.000Z" }] });
  });

  it("nouvelles questions : commande retrouvée, réponse préparée avec le vrai suivi, pas de doublon", async () => {
    mem.orders = [{ id: "O1", buyerUsername: "bob", status: "SHIPPED", trackingNumber: "9400111", carrier: "USPS", createdAt: new Date(), orderedAt: new Date(), shippedAt: new Date(), lines: [{ legacyItemId: "ITEM1" }] }];
    mem.questions = [q("1", "bob"), q("2", "alice")];
    expect(await syncBuyerMessages(user)).toEqual({ added: 2, drafted: 2 });
    expect(mem.msgs.find((m) => m.buyer === "bob")).toMatchObject({ orderId: "O1", draft: "Tracking: 9400111", status: "NEW" });
    expect(mem.msgs.find((m) => m.buyer === "alice")).toMatchObject({ orderId: null, draft: "Which order?" });
    expect(mem.answered).toHaveLength(0); // rien n'est envoyé tout seul
    expect(await syncBuyerMessages(user)).toEqual({ added: 0, drafted: 0 });
    // Répondue directement sur eBay : sortie de la liste.
    mem.questions = [q("1", "bob")];
    await syncBuyerMessages(user);
    expect(mem.msgs.find((m) => m.buyer === "alice")!.status).toBe("REPLIED");
  });

  it("envoi après relecture du vendeur, une seule fois ; ignorer", async () => {
    mem.questions = [q("1", "bob"), q("2", "eve")];
    await syncBuyerMessages(user, { drafts: 0 });
    const [a, b] = mem.msgs;
    await sendReply(user, a.id as string, "  Your order ships today.  ");
    expect(mem.answered).toEqual([{ itemId: "ITEM1", parentMessageId: "1", buyer: "bob", body: "Your order ships today." }]);
    expect(a).toMatchObject({ status: "REPLIED", draft: "Your order ships today." });
    await expect(sendReply(user, a.id as string, "again")).rejects.toThrow(MessageError);
    await expect(sendReply(user, b.id as string, "   ")).rejects.toThrow("EMPTY");
    await dismissMessage("U1", b.id as string);
    expect(b.status).toBe("DISMISSED");
    await expect(dismissMessage("U2", b.id as string)).rejects.toThrow("NOT_FOUND");
  });
});
