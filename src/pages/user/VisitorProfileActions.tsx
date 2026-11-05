import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Flag, Ban } from "lucide-react";
import SaveHelperButton from "@/components/SaveHelperButton";

/**
 * Q806: a visitor's title-row actions on someone's public profile (Save + the More options menu), moved verbatim out
 * of UserProfile.tsx (pure move). Only rendered when the viewer is signed in and not on their own profile.
 */
export function VisitorProfileActions({ userId, currentUserId, onReport, onBlock }: {
  userId: string | undefined;
  currentUserId: string;
  onReport: () => void;
  onBlock: () => void;
}) {
  return (
            <>
              {/* NO MESSAGE BUTTON HERE AT ALL (owner: "remove the message
                  button, only the poster can message").

                  It used to render behind a `canMessage` gate that opened on
                  any of three grounds — an existing thread, this person having
                  applied to one of the viewer's jobs, or the two having worked
                  together. Two of those let a HELPER open a channel, which is
                  the thing the rule is meant to prevent, and the third only
                  restated a thread that already exists in Messages.

                  A profile is now a place to READ about someone, never to
                  start a conversation with them. The poster's route is
                  unaffected: they message from the application, which is where
                  they were going to do it anyway, and an existing thread is
                  still in Messages. */}
              <SaveHelperButton helperId={userId!} customerId={currentUserId} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="More options">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onReport}>
                    <Flag className="w-4 h-4 mr-2" /> Report user
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onBlock}>
                    <Ban className="w-4 h-4 mr-2" /> Block user
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
  );
}
