import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

/** A dialog opened by code, the way the shortcuts open them: no trigger. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <textarea aria-label="note" />
      <button onClick={() => setOpen(true)}>open</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <input aria-label="inside" />
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("closing a dialog", () => {
  it("puts focus back where it was when the dialog opened", async () => {
    render(<Harness />);
    const note = screen.getByLabelText("note");
    note.focus();
    // The shortcut opens it without touching the page: focus is still here.
    fireEvent.click(screen.getByText("open"));
    await screen.findByText("Title");
    expect(document.activeElement).not.toBe(note);

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await new Promise(r => setTimeout(r, 50));

    expect(screen.queryByText("Title")).toBeNull();
    expect(document.activeElement).toBe(note);
  });
});
