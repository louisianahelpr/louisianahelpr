import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StickyNote, Plus, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { formatName } from "@/lib/utils";

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
  { value: "support", label: "Support", color: "bg-accent/10 text-accent-foreground border-accent/30" },
  { value: "billing", label: "Billing", color: "bg-secondary text-secondary-foreground border-border" },
];

const categoryStyle = (key: string) =>
  CATEGORIES.find((c) => c.value === key)?.color || CATEGORIES[0].color;

const categoryLabel = (key: string) =>
  CATEGORIES.find((c) => c.value === key)?.label || "General";

const AdminUserNotes = ({ userId }: AdminUserNotesProps) => {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(null);

  // Compose
  const [newNote, setNewNote] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingCategory, setEditingCategory] = useState("general");

  const loadNotes = async () => {
    setLoading(true);
    const { data: notesData, error } = await (supabase.from as any)("admin_user_notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load admin notes:", error);
      setNotes([]);
      setLoading(false);
      return;
    }

    const rows: NoteRow[] = notesData || [];
    const adminIds = [...new Set(rows.map((n) => n.admin_id))];
    if (adminIds.length === 0) {
      setNotes(rows);
      setLoading(false);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", adminIds);

    const nameMap = new Map(profiles?.map((p) => [p.user_id, p.full_name]) || []);
    setNotes(rows.map((n) => ({ ...n, admin_name: formatName(nameMap.get(n.admin_id), "Admin") })));
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentAdminId(data.user?.id || null));
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const addNote = async () => {
    const trimmed = newNote.trim();
    if (!trimmed) {
      toast.error("Write something before saving.");
      return;
    }
    if (!currentAdminId) {
      toast.error("Could not identify admin user.");
      return;
    }
    setSaving(true);
    const { error } = await (supabase.from as any)("admin_user_notes").insert({
      user_id: userId,
      admin_id: currentAdminId,
      note: trimmed,
      category: newCategory,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || "Failed to save note");
      return;
    }
    setNewNote("");
    setNewCategory("general");
    toast.success("Note saved");
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
      toast.error("Note can't be empty");
      return;
    }
    const { error } = await (supabase.from as any)("admin_user_notes")
      .update({ note: trimmed, category: editingCategory })
      .eq("id", id);
    if (error) {
      toast.error(error.message || "Failed to update note");
      return;
    }
    cancelEdit();
    toast.success("Note updated");
    loadNotes();
  };

  const removeNote = async (id: string) => {
    if (!confirm("Delete this note? This can't be undone.")) return;
    const { error } = await (supabase.from as any)("admin_user_notes").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "Failed to delete note");
      return;
    }
    toast.success("Note deleted");
    loadNotes();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
          <StickyNote className="w-3.5 h-3.5" /> Internal Admin Notes
          {notes.length > 0 && (
            <span className="text-muted-foreground/70">· {notes.length}</span>
          )}
        </p>
      </div>

      {/* Composer */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add an internal note about this user (only admins can see this)…"
          rows={3}
          className="text-sm resize-none"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={newCategory} onValueChange={setNewCategory}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value} className="text-xs">
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
      {loading ? (
        <p className="text-xs text-muted-foreground py-2">Loading notes…</p>
      ) : notes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-center">
          <p className="text-xs text-muted-foreground">No notes yet for this user.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => {
            const isOwner = currentAdminId === n.admin_id;
            const isEditing = editingId === n.id;
            const edited = n.updated_at && n.updated_at !== n.created_at;

            return (
              <div key={n.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-2 mb-1.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-5 px-1.5 ${categoryStyle(isEditing ? editingCategory : n.category)}`}
                  >
                    {categoryLabel(isEditing ? editingCategory : n.category)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-muted-foreground truncate">
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
                          className="h-6 w-6"
                          onClick={() => startEdit(n)}
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => removeNote(n.id)}
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
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      className="text-sm resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <Select value={editingCategory} onValueChange={setEditingCategory}>
                        <SelectTrigger className="h-7 w-[130px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value} className="text-xs">
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
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                    {n.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminUserNotes;
