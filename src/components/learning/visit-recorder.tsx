"use client";
import { useEffect, useRef } from "react";
import { recordLessonVisit } from "@/app/actions/learning";

/**
 * Marks a lesson as started the first time an active learner opens it (lessons without
 * a video player; the player saves its own position). Renders nothing; a failure only
 * means the lesson keeps showing "Not started" until the learner completes it.
 */
export function VisitRecorder({ offeringId, lessonId }: { offeringId: string; lessonId: string }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === lessonId) return;
    sent.current = lessonId;
    recordLessonVisit({ offeringId, lessonId }).catch(() => undefined);
  }, [offeringId, lessonId]);
  return null;
}
