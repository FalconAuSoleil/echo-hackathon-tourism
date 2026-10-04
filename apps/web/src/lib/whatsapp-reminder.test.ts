import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { addWhatsappToDelete, getSettings, openEchoDB, originalStaysInWhatsapp, saveSettings } from "./db.ts";

describe("reminder to delete the original voice note in WhatsApp (visitor card: the sound is deleted after analysis)", () => {
  it("counts shared and imported voice messages, not recordings or text, and resets when the host confirms", async () => {
    expect(originalStaysInWhatsapp({ kind: "audio", via: "share" })).toBe(true);
    expect(originalStaysInWhatsapp({ kind: "audio", via: "file" })).toBe(true);
    expect(originalStaysInWhatsapp({ kind: "audio", via: "record" })).toBe(false);
    expect(originalStaysInWhatsapp({ kind: "text", via: "share" })).toBe(false);

    const db = await openEchoDB("test-whatsapp");
    expect((await getSettings(db)).whatsappToDelete).toBeUndefined();
    expect(await addWhatsappToDelete(db, 1)).toBe(1);
    expect(await addWhatsappToDelete(db, 2)).toBe(3);
    expect((await getSettings(db)).whatsappToDelete).toBe(3);
    await saveSettings(db, { whatsappToDelete: 0 });
    expect((await getSettings(db)).whatsappToDelete).toBe(0);
  });
});
