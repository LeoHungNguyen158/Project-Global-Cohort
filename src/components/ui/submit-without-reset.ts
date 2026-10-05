"use client";
import { startTransition, type FormEvent } from "react";

/**
 * onSubmit handler for forms whose `action` is a server action dispatcher.
 *
 * React resets every uncontrolled field once a form action returns, even when the
 * server rejected the input, which would erase what the person typed. Preventing the
 * native submission and dispatching inside a transition keeps the input, and React
 * still reports the pending state to `useFormStatus`. Without JavaScript the form
 * posts through its `action` as usual.
 */
export function submitWithoutReset(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };
}
