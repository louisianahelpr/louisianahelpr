import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, mutationErrorMessage, isWriteRejected } from "@/lib/mutationResult";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import { StickyNote, Plus, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";
import { useInstantQuery } from "@/hooks/useInstantQuery";

interface AdminUserNotesProps {
  userId: string;
}

interface NoteRow {
  id: string;
  user_id: string;
  admin_id: string;
  note: string;
  category: string;
  created_at: string;
  updated_at: string;
  admin_name?: string;
}

const CATEGORIES = [
  { value: "general", label: "General", color: "bg-muted text-muted-foreground border-border" },
  { value: "behavior", label: "Behavior", color: "bg-destructive/10 text-destructive border-destructive/30" },
  { value: "verification", label: "Verification", color: "bg-primary/10 text-primary border-primary/30" },
  { value: "support", label: "Support", color: "bg-accent/10 text-accent border-accent/30" },
  { value: "billing", label: "Billing", color: "bg-secondary text-secondary-foreground border-border" },
];

const categoryStyle = (key: string) =>
  CATEGORIES.find((c) => c.value === key)?.color || CATEGORIES[0].color;

const categoryLabel = (key: string) =>
  CATEGORIES.find((c) => c.value === key)?.label || "General";

const AdminUserNotes = ({ userId }: AdminUserNotesProps) => {
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  // Compose
  const [newNote, setNewNote] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingCategory, setEditingCategory] = useState("general");

  // Delete confirmation
  const [deleteNote, setDeleteNote] = useState<NoteRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: notes, isInitialLoading, refetch } = useInstantQuery<NoteRow[]>({
    key: ["admin-user-notes", userId],
    fallback: [],
    fetcher: async () => {
      const { data: notesData, error } = await supabase.from("admin_user_notes")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        report(error, { tags: { source: "AdminUserNotes.load" } });
        return [];
      }

      const rows: NoteRow[] = notesData || [];
      const adminIds = [...new Set(rows.map((n) => n.admin_id))];
      if (adminIds.length === 0) return rows;

      // Secondary name-hydration read. Don't drop the error: on failure every
      // row silently renders the "Unknown"/fallback name, which looks like real
      // data rather than a failed lookup. Report it, then still render the list
      // — a missing display name must not blank the whole surface.
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", adminIds);
      if (profilesError) report(profilesError, { severity: "warning", tags: { source: "AdminUserNotes.hydrateNames" } });

      const nameMap = new Map(profiles?.map((p) => [p.user_id, p.full_name]) || []);
      return rows.map((n) => ({ ...n, admin_name: formatName(nameMap.get(n.admin_id), "Admin") }));
    },
  });
  const loadNotes = () => refetch();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentAdminId(data.user?.id || null));
  }, []);

  const addNote = async () => {
    const trimmed = newNote.trim();
    if (!trimmed) {
      toast.error("Write something before saving.");
      return;
    }
    if (!currentAdminId) {
      toast.error("Couldn't identify admin user.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("admin_user_notes").insert({
      user_id: userId,
      admin_id: currentAdminId,
      note: trimmed,
      category: newCategory,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || "Couldn't save that note — try again");
      return;
    }
    setNewNote("");
    setNewCategory("general");
    loadNotes();
  };

  const startEdit = (n: NoteRow) => {
    setEditingId(n.id);
    setEditingText(n.note);
    setEditingCategory(n.category);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
    setEditingCategory("general");
  };

  const saveEdit = async (id: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) {
      toast.error("Note can't be empty.");
      return;
    }
    // A moderation record. Zero rows is NOT a legitimate outcome — the note is
    // on screen, so it exists; zero rows means RLS refused the write. Without
    // the guard `cancelEdit()` closed the editor and `loadNotes()` refetched,
    // so the old text reappeared and a REFUSED write read as a UI glitch the
    // admin would shrug at and retype.
    try {
      unwrapMutation(
        await supabase.from("admin_user_notes")
          .update({ note: trimmed, category: editingCategory })
          .eq("id", id)
          .select("id"),
        {
          action: "update this note",
          rejectedMessage: "That note wasn't updated — the change was refused. Your edit is still here; check your admin permissions.",
          context: { noteId: id },
        },
      );
    } catch (err) {
      if (!isWriteRejected(err)) {
        report(err instanceof Error ? err : new Error(String(err)), {
          tags: { source: "AdminUserNotes.saveEdit" },
        });
      }
      // Deliberately does NOT call cancelEdit(): the editor stays open with the
      // text the admin wrote, so a refused save can be retried rather than lost.
      toast.error(mutationErrorMessage(err, "Couldn't update that note — try again"));
      return;
    }
    cancelEdit();
    loadNotes();
  };

  const removeNote = async () => {
    if (!deleteNote) return;
    setDeleting(true);
    // Same reasoning as saveEdit: a DELETE matching zero rows returns
    // `{ data: [], error: null }`, and the note visibly reappearing after
    // `loadNotes()` looked like a refresh quirk rather than a refused delete.
    try {
      unwrapMutation(
        await supabase.from("admin_user_notes").delete().eq("id", deleteNote.id).select("id"),
        {
          action: "delete this note",
          rejectedMessage: "That note wasn't deleted — the delete was refused. Check your admin permissions.",
          context: { noteId: deleteNote.id },
        },
      );
    } catch (err) {
      setDeleting(false);
      if (!isWriteRejected(err)) {
        report(err instanceof Error ? err : new Error(String(err)), {
          tags: { source: "AdminUserNotes.removeNote" },
        });
      }
      toast.error(mutationErrorMessage(err, "Couldn't delete that note — try again"));
      return;
    }
    setDeleting(false);
    setDeleteNote(null);
    loadNotes();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <StickyNote className="w-3.5 h-3.5" /> Internal Admin Notes
          {notes.length > 0 && (
            <span className="text-muted-foreground/70">· {notes.length}</span>
          )}
        </p>
      </div>

      {/* Composer */}
      <div className="rounded-ds-sm liquid-glass p-3 space-y-2">
        <Textarea
          aria-label="New admin note"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add an internal note about this user (only admins can see this)…"
          rows={3}
          className="text-ds-13 resize-none"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={newCategory} onValueChange={setNewCategory}>
            <SelectTrigger aria-label="Note category" className="h-8 w-[140px] text-ds-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value} className="text-ds-11">
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 ml-auto"
            onClick={addNote}
            disabled={saving || !newNote.trim()}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
            ) : (
              <Plus className="w-3.5 h-3.5 mr-1" />
            )}
            Save Note
          </Button>
        </div>
      </div>

      {/* Notes list */}
      {isInitialLoading ? (
        <p className="text-ds-11 text-muted-foreground py-2">Loading notes…</p>
      ) : notes.length === 0 ? null : (
        <div className="space-y-2">
          {notes.map((n) => {
            const isOwner = currentAdminId === n.admin_id;
            const isEditing = editingId === n.id;
            const edited = n.updated_at && n.updated_at !== n.created_at;

            return (
              <div key={n.id} className="rounded-ds-sm liquid-glass p-3">
                <div className="flex items-start gap-2 mb-1.5">
                  <Badge
                    variant="outline"
                    className={`text-ds-10 h-5 px-1.5 ${categoryStyle(isEditing ? editingCategory : n.category)}`}
                  >
                    {categoryLabel(isEditing ? editingCategory : n.category)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-ds-11 text-muted-foreground truncate">
                      <span className="font-medium text-foreground">{n.admin_name}</span>
                      <span className="mx-1">·</span>
                      <span title={format(new Date(n.created_at), "PPpp")}>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </span>
                      {edited && (
                        <span className="ml-1 italic" title={`Edited ${format(new Date(n.updated_at), "PPpp")}`}>
                          (edited)
                        </span>
                      )}
                    </p>
                  </div>
                  {!isEditing && (
                    <div className="flex gap-1 flex-shrink-0">
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEdit(n)}
                          aria-label="Edit note"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteNote(n)}
                        aria-label="Delete note"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      aria-label="Edit note"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      className="text-ds-13 resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <Select value={editingCategory} onValueChange={setEditingCategory}>
                        <SelectTrigger aria-label="Note category" className="h-7 w-[130px] text-ds-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value} className="text-ds-11">
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="ml-auto flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={cancelEdit}>
                          <X className="w-3.5 h-3.5 mr-1" /> Cancel
                        </Button>
                        <Button size="sm" className="h-7 px-2" onClick={() => saveEdit(n.id)}>
                          <Check className="w-3.5 h-3.5 mr-1" /> Save
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-ds-13 text-foreground whitespace-pre-wrap break-words leading-relaxed">
                    {n.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteNote} onOpenChange={(open) => !open && setDeleteNote(null)}>
        <AlertDialogContent>
          <AlertDialogHero
            title="Delete This Note?"
          />
          {deleteNote && (
            <div className="rounded-ds-sm border border-border bg-secondary/30 p-3 text-ds-13 text-foreground whitespace-pre-wrap break-words max-h-40 overflow-auto">
              {deleteNote.note}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); removeNote(); }}
              disabled={deleting}
              variant="destructive"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
              Delete Note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminUserNotes;
