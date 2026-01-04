// src/hooks/useCommentOutbox.ts

import { useState } from 'react';

// Comment outbox item definition
interface CommentOutboxItem {
  id: string; // Unique identifier for each comment
  parentEventId: string; // Parent event ID that the comment belongs to
  content: string; // The comment content
  status: 'pending' | 'published'; // Comment status
}

// Hook for managing the comment outbox queue
export const useCommentOutbox = () => {
  const [outbox, setOutbox] = useState<CommentOutboxItem[]>([]);

  // Function to add a comment to the outbox queue
  const addToOutbox = (parentEventId: string, content: string) => {
    const newComment: CommentOutboxItem = {
      id: `${Date.now()}`, // Unique ID based on timestamp
      parentEventId,
      content,
      status: 'pending',
    };
    setOutbox((prevOutbox) => [...prevOutbox, newComment]);
  };

  // Function to publish a comment when the event ID is available
  const publishComment = (commentId: string) => {
    setOutbox((prevOutbox) =>
      prevOutbox.map((comment) =>
        comment.id === commentId ? { ...comment, status: 'published' } : comment
      )
    );
  };

  // Function to get all pending comments
  const getPendingComments = () => {
    return outbox.filter((comment) => comment.status === 'pending');
  };

  return {
    outbox,
    addToOutbox,
    publishComment,
    getPendingComments,
  };
};
