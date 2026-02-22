import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  getBlazeWriteTags,
  getBlazeRenameTags,
  getBlazeAddDependencyTags,
  getBlazeDeleteTags,
} from "../ipc/utils/blaze_tag_parser";

import { processFullResponseActions } from "../ipc/processors/response_processor";
import {
  removeBlazeTags,
  hasUnclosedBlazeWrite,
  buildDiagnosticStatusTag,
  extractActionTagsForManualApproval,
  sanitizeGeneratedSummary,
  formatSelectedComponentLabel,
  formatSelectedComponentPromptBlock,
} from "../ipc/handlers/chat_stream_handlers";
import fs from "node:fs";
import { db } from "../db";
import { cleanFullResponse } from "../ipc/utils/cleanFullResponse";
import {
  gitAdd,
  gitRemove,
  gitCommit,
  isGitStatusClean,
} from "../ipc/utils/git_utils";

// Mock fs with default export
vi.mock("node:fs", async () => {
  return {
    default: {
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn().mockReturnValue(false), // Default to false to avoid creating temp directory
      renameSync: vi.fn(),
      unlinkSync: vi.fn(),
      lstatSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
      promises: {
        readFile: vi.fn().mockResolvedValue(""),
      },
    },
    existsSync: vi.fn().mockReturnValue(false), // Also mock the named export
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    lstatSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
    promises: {
      readFile: vi.fn().mockResolvedValue(""),
    },
  };
});

// Mock Git utils
vi.mock("../ipc/utils/git_utils", () => ({
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitRemove: vi.fn(),
  isGitStatusClean: vi.fn().mockResolvedValue(false),
  gitRenameBranch: vi.fn(),
  gitCurrentBranch: vi.fn(),
  gitLog: vi.fn(),
  gitInit: vi.fn(),
  gitPush: vi.fn(),
  gitSetRemoteUrl: vi.fn(),
  gitStatus: vi.fn().mockResolvedValue([]),
  getGitUncommittedFiles: vi.fn().mockResolvedValue([]),
}));

// Mock paths module to control getBlazeAppPath
vi.mock("../paths/paths", () => ({
  getBlazeAppPath: vi.fn().mockImplementation((appPath) => {
    return `/mock/user/data/path/${appPath}`;
  }),
  getUserDataPath: vi.fn().mockReturnValue("/mock/user/data/path"),
}));

// Mock db
vi.mock("../db", () => ({
  db: {
    query: {
      chats: {
        findFirst: vi.fn(),
      },
      messages: {
        findFirst: vi.fn(),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
}));

describe("getBlazeAddDependencyTags", () => {
  it("should return an empty array when no blaze-add-dependency tags are found", () => {
    const result = getBlazeAddDependencyTags(
      "No blaze-add-dependency tags here",
    );
    expect(result).toEqual([]);
  });

  it("should return an array of blaze-add-dependency tags", () => {
    const result = getBlazeAddDependencyTags(
      `<blaze-add-dependency packages="uuid"></blaze-add-dependency>`,
    );
    expect(result).toEqual(["uuid"]);
  });

  it("should return all the packages in the blaze-add-dependency tags", () => {
    const result = getBlazeAddDependencyTags(
      `<blaze-add-dependency packages="pkg1 pkg2"></blaze-add-dependency>`,
    );
    expect(result).toEqual(["pkg1", "pkg2"]);
  });

  it("should return all the packages in the blaze-add-dependency tags", () => {
    const result = getBlazeAddDependencyTags(
      `txt before<blaze-add-dependency packages="pkg1 pkg2"></blaze-add-dependency>text after`,
    );
    expect(result).toEqual(["pkg1", "pkg2"]);
  });

  it("should return all the packages in multiple blaze-add-dependency tags", () => {
    const result = getBlazeAddDependencyTags(
      `txt before<blaze-add-dependency packages="pkg1 pkg2"></blaze-add-dependency>txt between<blaze-add-dependency packages="pkg3"></blaze-add-dependency>text after`,
    );
    expect(result).toEqual(["pkg1", "pkg2", "pkg3"]);
  });
});
describe("getBlazeWriteTags", () => {
  it("should return an empty array when no blaze-write tags are found", () => {
    const result = getBlazeWriteTags("No blaze-write tags here");
    expect(result).toEqual([]);
  });

  it("should return a blaze-write tag", () => {
    const result =
      getBlazeWriteTags(`<blaze-write path="src/components/TodoItem.tsx" description="Creating a component for individual todo items">
import React from "react";
console.log("TodoItem");
</blaze-write>`);
    expect(result).toEqual([
      {
        path: "src/components/TodoItem.tsx",
        description: "Creating a component for individual todo items",
        content: `import React from "react";
console.log("TodoItem");`,
      },
    ]);
  });

  it("should strip out code fence (if needed) from a blaze-write tag", () => {
    const result =
      getBlazeWriteTags(`<blaze-write path="src/components/TodoItem.tsx" description="Creating a component for individual todo items">
\`\`\`tsx
import React from "react";
console.log("TodoItem");
\`\`\`
</blaze-write>
`);
    expect(result).toEqual([
      {
        path: "src/components/TodoItem.tsx",
        description: "Creating a component for individual todo items",
        content: `import React from "react";
console.log("TodoItem");`,
      },
    ]);
  });

  it("should handle missing description", () => {
    const result = getBlazeWriteTags(`
      <blaze-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx">
import React from 'react';
</blaze-write>
    `);
    expect(result).toEqual([
      {
        path: "src/pages/locations/neighborhoods/louisville/Highlands.tsx",
        description: undefined,
        content: `import React from 'react';`,
      },
    ]);
  });

  it("should handle extra space", () => {
    const result = getBlazeWriteTags(
      cleanFullResponse(`
      <blaze-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags." >
import React from 'react';
</blaze-write>
    `),
    );
    expect(result).toEqual([
      {
        path: "src/pages/locations/neighborhoods/louisville/Highlands.tsx",
        description: "Updating Highlands neighborhood page to use ＜a＞ tags.",
        content: `import React from 'react';`,
      },
    ]);
  });

  it("should handle nested tags", () => {
    const result = getBlazeWriteTags(
      cleanFullResponse(`
      BEFORE TAG
  <blaze-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</blaze-write>
AFTER TAG
    `),
    );
    expect(result).toEqual([
      {
        path: "src/pages/locations/neighborhoods/louisville/Highlands.tsx",
        description: "Updating Highlands neighborhood page to use ＜a＞ tags.",
        content: `import React from 'react';`,
      },
    ]);
  });

  it("should handle nested tags after preprocessing", () => {
    // Simulate the preprocessing step that cleanFullResponse would do
    const inputWithNestedTags = `
      BEFORE TAG
  <blaze-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</blaze-write>
AFTER TAG
    `;

    const cleanedInput = cleanFullResponse(inputWithNestedTags);

    const result = getBlazeWriteTags(cleanedInput);
    expect(result).toEqual([
      {
        path: "src/pages/locations/neighborhoods/louisville/Highlands.tsx",
        description: "Updating Highlands neighborhood page to use ＜a＞ tags.",
        content: `import React from 'react';`,
      },
    ]);
  });

  it("should handle multiple nested tags after preprocessing", () => {
    const inputWithMultipleNestedTags = `<blaze-write path="src/file.tsx" description="Testing <div> and <span> and <a> tags.">content</blaze-write>`;

    // This simulates what cleanFullResponse should do
    const cleanedInput = cleanFullResponse(inputWithMultipleNestedTags);
    const result = getBlazeWriteTags(cleanedInput);
    expect(result).toEqual([
      {
        path: "src/file.tsx",
        description: "Testing ＜div＞ and ＜span＞ and ＜a＞ tags.",
        content: `content`,
      },
    ]);
  });

  it("should handle nested tags in multiple attributes", () => {
    const inputWithNestedInMultipleAttrs = `<blaze-write path="src/<component>.tsx" description="Testing <div> tags.">content</blaze-write>`;

    // This simulates what cleanFullResponse should do
    const cleanedInput = cleanFullResponse(inputWithNestedInMultipleAttrs);

    const result = getBlazeWriteTags(cleanedInput);
    expect(result).toEqual([
      {
        path: "src/＜component＞.tsx",
        description: "Testing ＜div＞ tags.",
        content: `content`,
      },
    ]);
  });

  it("should return an array of blaze-write tags", () => {
    const result = getBlazeWriteTags(
      `I'll create a simple todo list app using React, TypeScript, and shadcn/ui components. Let's get started!

First, I'll create the necessary files for our todo list application:

<blaze-write path="src/types/todo.ts" description="Creating types for our todo items">
export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}
</blaze-write>

<blaze-write path="src/components/TodoItem.tsx" description="Creating a component for individual todo items">
import React from "react";
import { Trash2, Check, X } from "lucide-react";
import { Todo } from "../types/todo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TodoItemProps {
  todo: Todo;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

const TodoItem: React.FC<TodoItemProps> = ({ todo, onToggle, onDelete }) => {
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg mb-2 bg-white shadow-sm">
      <div className="flex items-center gap-3 flex-1">
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "h-6 w-6 rounded-full",
            todo.completed && "bg-green-100 text-green-600"
          )}
          onClick={() => onToggle(todo.id)}
        >
          {todo.completed ? (
            <Check className="h-4 w-4" />
          ) : (
            <X className="h-4 w-4 opacity-0" />
          )}
        </Button>
        <span
          className={cn(
            "text-sm",
            todo.completed && "line-through text-gray-500"
          )}
        >
          {todo.text}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
        onClick={() => onDelete(todo.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default TodoItem;
</blaze-write>

<blaze-write path="src/components/TodoForm.tsx" description="Creating a form component for adding new todos">
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusCircle } from "lucide-react";

interface TodoFormProps {
  onAddTodo: (text: string) => void;
}

const TodoForm: React.FC<TodoFormProps> = ({ onAddTodo }) => {
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onAddTodo(text.trim());
      setText("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
      <Input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a new task..."
        className="flex-1"
      />
      <Button type="submit" disabled={!text.trim()}>
        <PlusCircle className="h-4 w-4 mr-2" />
        Add
      </Button>
    </form>
  );
};

export default TodoForm;
</blaze-write>

<blaze-write path="src/components/TodoList.tsx" description="Creating the main todo list component">
import React from "react";
import { Todo } from "../types/todo";
import TodoItem from "./TodoItem";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TodoListProps {
  todos: Todo[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

const TodoList: React.FC<TodoListProps> = ({ todos, onToggle, onDelete }) => {
  if (todos.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No tasks yet. Add one above!
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px] rounded-md border p-4">
      <div className="space-y-2">
        {todos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </div>
    </ScrollArea>
  );
};

export default TodoList;
</blaze-write>

<blaze-write path="src/components/TodoStats.tsx" description="Creating a component to show todo statistics">
import React from "react";
import { Todo } from "../types/todo";
import { Card, CardContent } from "@/components/ui/card";

interface TodoStatsProps {
  todos: Todo[];
}

const TodoStats: React.FC<TodoStatsProps> = ({ todos }) => {
  const total = todos.length;
  const completed = todos.filter((todo) => todo.completed).length;
  const pending = total - completed;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-500">Total Tasks</p>
            <p className="text-3xl font-bold">{total}</p>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-500">Completed</p>
            <p className="text-3xl font-bold text-green-600">{completed}</p>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-500">Pending</p>
            <p className="text-3xl font-bold text-amber-600">{pending}</p>
          </div>
        </CardContent>
      </Card>
      
      <Card className="md:col-span-3">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>{percentComplete}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-300"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TodoStats;
</blaze-write>

<blaze-write path="src/pages/Index.tsx" description="Creating the main page for our todo app">
import React, { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Todo } from "../types/todo";
import TodoForm from "../components/TodoForm";
import TodoList from "../components/TodoList";
import TodoStats from "../components/TodoStats";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/components/ui/use-toast";

const Index: React.FC = () => {
  const [todos, setTodos] = useState<Todo[]>(() => {
    const savedTodos = localStorage.getItem("todos");
    if (savedTodos) {
      try {
        // Parse the saved todos and convert string dates back to Date objects
        return JSON.parse(savedTodos).map((todo: any) => ({
          ...todo,
          createdAt: new Date(todo.createdAt)
        }));
      } catch (e) {
        console.error("Failed to parse saved todos", e);
        return [];
      }
    }
    return [];
  });

  const { toast } = useToast();

  // Save todos to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("todos", JSON.stringify(todos));
  }, [todos]);

  const handleAddTodo = (text: string) => {
    const newTodo: Todo = {
      id: uuidv4(),
      text,
      completed: false,
      createdAt: new Date()
    };
    
    setTodos([...todos, newTodo]);
    toast({
      title: "Task added",
      description: "Your new task has been added successfully.",
    });
  };

  const handleToggleTodo = (id: string) => {
    setTodos(
      todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
    
    const todo = todos.find(t => t.id === id);
    if (todo) {
      toast({
        title: todo.completed ? "Task marked as incomplete" : "Task completed",
        description: todo.text,
      });
    }
  };

  const handleDeleteTodo = (id: string) => {
    const todoToDelete = todos.find(todo => todo.id === id);
    setTodos(todos.filter((todo) => todo.id !== id));
    
    if (todoToDelete) {
      toast({
        title: "Task deleted",
        description: todoToDelete.text,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-2 text-center">Todo List</h1>
      <p className="text-gray-500 mb-8 text-center">
        Keep track of your tasks and stay organized
      </p>
      
      <TodoStats todos={todos} />
      <TodoForm onAddTodo={handleAddTodo} />
      <TodoList
        todos={todos}
        onToggle={handleToggleTodo}
        onDelete={handleDeleteTodo}
      />
      <Toaster />
    </div>
  );
};

export default Index;
</blaze-write>

<blaze-add-dependency packages="uuid"></blaze-add-dependency>

<blaze-write path="src/types/uuid.d.ts" description="Adding type definitions for uuid">
declare module 'uuid' {
  export function v4(): string;
}
</blaze-write>

I've created a complete todo list application with the ability to add, complete, and delete tasks. The app includes statistics and uses local storage to persist data.`,
    );
    expect(result.length).toEqual(7);
  });
});

describe("getBlazeRenameTags", () => {
  it("should return an empty array when no blaze-rename tags are found", () => {
    const result = getBlazeRenameTags("No blaze-rename tags here");
    expect(result).toEqual([]);
  });

  it("should return an array of blaze-rename tags", () => {
    const result = getBlazeRenameTags(
      `<blaze-rename from="src/components/UserProfile.jsx" to="src/components/ProfileCard.jsx"></blaze-rename>
      <blaze-rename from="src/utils/helpers.js" to="src/utils/utils.js"></blaze-rename>`,
    );
    expect(result).toEqual([
      {
        from: "src/components/UserProfile.jsx",
        to: "src/components/ProfileCard.jsx",
      },
      { from: "src/utils/helpers.js", to: "src/utils/utils.js" },
    ]);
  });
});

describe("getBlazeDeleteTags", () => {
  it("should return an empty array when no blaze-delete tags are found", () => {
    const result = getBlazeDeleteTags("No blaze-delete tags here");
    expect(result).toEqual([]);
  });

  it("should return an array of blaze-delete paths", () => {
    const result = getBlazeDeleteTags(
      `<blaze-delete path="src/components/Analytics.jsx"></blaze-delete>
      <blaze-delete path="src/utils/unused.js"></blaze-delete>`,
    );
    expect(result).toEqual([
      "src/components/Analytics.jsx",
      "src/utils/unused.js",
    ]);
  });
});

describe("processFullResponse", () => {
  const getDbUpdatePayloads = () => {
    return vi.mocked(db.update).mock.results.flatMap((result) => {
      const setMock = (result.value as any)?.set;
      if (!setMock?.mock?.calls) {
        return [];
      }
      return setMock.mock.calls.map((call: any[]) => call[0]);
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock db query response
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: 1,
      appId: 1,
      title: "Test Chat",
      createdAt: new Date(),
      app: {
        id: 1,
        name: "Mock App",
        path: "mock-app-path",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      messages: [],
    } as any);

    vi.mocked(db.query.messages.findFirst).mockResolvedValue({
      id: 1,
      chatId: 1,
      role: "assistant",
      content: "some content",
      createdAt: new Date(),
      approvalState: null,
      commitHash: null,
    } as any);

    // Default mock for existsSync to return true
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(isGitStatusClean).mockResolvedValue(false);
  });

  it("should return empty object when no blaze-write tags are found", async () => {
    const result = await processFullResponseActions(
      "No blaze-write tags here",
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );
    expect(result).toEqual({
      updatedFiles: false,
      extraFiles: undefined,
      extraFilesError: undefined,
    });
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("should not append completion metadata when there are no warnings or errors", async () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    const response = `<blaze-write path="src/file1.js">console.log('Hello');</blaze-write>`;

    await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    const contentUpdate = getDbUpdatePayloads().find(
      (payload) => typeof payload?.content === "string",
    ) as { content?: string } | undefined;

    expect(contentUpdate).toBeUndefined();
  });

  it("should not append completion metadata when no file changes were required", async () => {
    await processFullResponseActions("No blaze-write tags here", 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    const contentUpdate = getDbUpdatePayloads().find(
      (payload) => typeof payload?.content === "string",
    ) as { content?: string } | undefined;

    expect(contentUpdate).toBeUndefined();
  });

  it("should process blaze-write tags and create files", async () => {
    // Set up fs mocks to succeed
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    const response = `<blaze-write path="src/file1.js">console.log('Hello');</blaze-write>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src",
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/file1.js",
      "console.log('Hello');",
    );
    expect(gitAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/file1.js",
      }),
    );
    expect(gitCommit).toHaveBeenCalled();
    expect(result).toEqual({ updatedFiles: true });
  });

  it("should skip commit when applied changes produce no git diff", async () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(isGitStatusClean).mockResolvedValue(true);

    const response = `<blaze-write path="src/file1.js">console.log('Hello');</blaze-write>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(gitAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/file1.js",
      }),
    );
    expect(gitCommit).not.toHaveBeenCalled();
    expect(result).toEqual({
      updatedFiles: false,
      extraFiles: undefined,
      extraFilesError: undefined,
    });
  });

  it("should return an explicit error when search-replace fails and no other changes are applied", async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      `export const heroTitle = "Быстрый запуск";`,
    );

    const response = `<blaze-search-replace path="src/Landing.tsx">
<<<<<<< SEARCH
export const heroTitle = "Быстрый старт";
=======
export const heroTitle = "Моментальный запуск";
>>>>>>> REPLACE
</blaze-search-replace>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(result.updatedFiles).toBe(false);
    expect(result.error).toContain("Failed to apply search-replace edits");
    expect(gitCommit).not.toHaveBeenCalled();
  });

  it("should still commit other file changes when search-replace fails", async () => {
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      `export const heroTitle = "Быстрый запуск";`,
    );
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    const response = `
    <blaze-search-replace path="src/Landing.tsx">
<<<<<<< SEARCH
export const heroTitle = "Быстрый старт";
=======
export const heroTitle = "Моментальный запуск";
>>>>>>> REPLACE
    </blaze-search-replace>
    <blaze-write path="src/Landing.tsx">export const heroTitle = "Моментальный запуск";</blaze-write>
    `;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(result).toEqual({ updatedFiles: true });
    expect(gitCommit).toHaveBeenCalledTimes(1);
  });

  it("should handle file system errors gracefully", async () => {
    // Set up the mock to throw an error on mkdirSync
    vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
      throw new Error("Mock filesystem error");
    });

    const response = `<blaze-write path="src/error-file.js">This will fail</blaze-write>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(result).toHaveProperty("error");
    expect(result.error).toContain("Mock filesystem error");
  });

  it("should process multiple blaze-write tags and commit all files", async () => {
    // Clear previous mock calls
    vi.clearAllMocks();

    // Set up fs mocks to succeed
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    const response = `
    <blaze-write path="src/file1.js">console.log('First file');</blaze-write>
    <blaze-write path="src/utils/file2.js">export const add = (a, b) => a + b;</blaze-write>
    <blaze-write path="src/components/Button.tsx">
    import React from 'react';
    export const Button = ({ children }) => <button>{children}</button>;
    </blaze-write>
    `;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    // Check that directories were created for each file path
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src",
      { recursive: true },
    );
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/utils",
      { recursive: true },
    );
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/components",
      { recursive: true },
    );

    // Using toHaveBeenNthCalledWith to check each specific call
    expect(fs.writeFileSync).toHaveBeenNthCalledWith(
      1,
      "/mock/user/data/path/mock-app-path/src/file1.js",
      "console.log('First file');",
    );
    expect(fs.writeFileSync).toHaveBeenNthCalledWith(
      2,
      "/mock/user/data/path/mock-app-path/src/utils/file2.js",
      "export const add = (a, b) => a + b;",
    );
    expect(fs.writeFileSync).toHaveBeenNthCalledWith(
      3,
      "/mock/user/data/path/mock-app-path/src/components/Button.tsx",
      "import React from 'react';\n    export const Button = ({ children }) => <button>{children}</button>;",
    );

    // Verify git operations were called for each file
    expect(gitAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/file1.js",
      }),
    );
    expect(gitAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/utils/file2.js",
      }),
    );
    expect(gitAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/components/Button.tsx",
      }),
    );

    // Verify commit was called once after all files were added
    expect(gitCommit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ updatedFiles: true });
  });

  it("should process blaze-rename tags and rename files", async () => {
    // Set up fs mocks to succeed
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);

    const response = `<blaze-rename from="src/components/OldComponent.jsx" to="src/components/NewComponent.jsx"></blaze-rename>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/components",
      { recursive: true },
    );
    expect(fs.renameSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/components/OldComponent.jsx",
      "/mock/user/data/path/mock-app-path/src/components/NewComponent.jsx",
    );
    expect(gitAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/components/NewComponent.jsx",
      }),
    );
    expect(gitRemove).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/components/OldComponent.jsx",
      }),
    );
    expect(gitCommit).toHaveBeenCalled();
    expect(result).toEqual({ updatedFiles: true });
  });

  it("should handle non-existent files during rename gracefully", async () => {
    // Set up the mock to return false for existsSync
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const response = `<blaze-rename from="src/components/NonExistent.jsx" to="src/components/NewFile.jsx"></blaze-rename>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
    expect(gitCommit).not.toHaveBeenCalled();
    expect(result).toEqual({
      updatedFiles: false,
      extraFiles: undefined,
      extraFilesError: undefined,
    });
  });

  it("should process blaze-delete tags and delete files", async () => {
    // Set up fs mocks to succeed
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

    const response = `<blaze-delete path="src/components/Unused.jsx"></blaze-delete>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(fs.unlinkSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/components/Unused.jsx",
    );
    expect(gitRemove).toHaveBeenCalledWith(
      expect.objectContaining({
        filepath: "src/components/Unused.jsx",
      }),
    );
    expect(gitCommit).toHaveBeenCalled();
    expect(result).toEqual({ updatedFiles: true });
  });

  it("should handle non-existent files during delete gracefully", async () => {
    // Set up the mock to return false for existsSync
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const response = `<blaze-delete path="src/components/NonExistent.jsx"></blaze-delete>`;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    expect(fs.unlinkSync).not.toHaveBeenCalled();
    expect(gitRemove).not.toHaveBeenCalled();
    expect(gitCommit).not.toHaveBeenCalled();
    expect(result).toEqual({
      updatedFiles: false,
      extraFiles: undefined,
      extraFilesError: undefined,
    });
  });

  it("should process mixed operations (write, rename, delete) in one response", async () => {
    // Set up fs mocks to succeed
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);

    const response = `
    <blaze-write path="src/components/NewComponent.jsx">import React from 'react'; export default () => <div>New</div>;</blaze-write>
    <blaze-rename from="src/components/OldComponent.jsx" to="src/components/RenamedComponent.jsx"></blaze-rename>
    <blaze-delete path="src/components/Unused.jsx"></blaze-delete>
    `;

    const result = await processFullResponseActions(response, 1, {
      chatSummary: undefined,
      messageId: 1,
    });

    // Check write operation happened
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/components/NewComponent.jsx",
      "import React from 'react'; export default () => <div>New</div>;",
    );

    // Check rename operation happened
    expect(fs.renameSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/components/OldComponent.jsx",
      "/mock/user/data/path/mock-app-path/src/components/RenamedComponent.jsx",
    );

    // Check delete operation happened
    expect(fs.unlinkSync).toHaveBeenCalledWith(
      "/mock/user/data/path/mock-app-path/src/components/Unused.jsx",
    );

    // Check git operations
    expect(gitAdd).toHaveBeenCalledTimes(2); // For the write and rename
    expect(gitRemove).toHaveBeenCalledTimes(2); // For the rename and delete

    // Check the commit message includes all operations
    expect(gitCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "wrote 1 file(s), renamed 1 file(s), deleted 1 file(s)",
        ),
      }),
    );

    expect(result).toEqual({ updatedFiles: true });
  });
});

describe("removeBlazeTags", () => {
  it("should return empty string when input is empty", () => {
    const result = removeBlazeTags("");
    expect(result).toBe("");
  });

  it("should return the same text when no blaze tags are present", () => {
    const text = "This is a regular text without any blaze tags.";
    const result = removeBlazeTags(text);
    expect(result).toBe(text);
  });

  it("should remove a single blaze-write tag", () => {
    const text = `Before text <blaze-write path="src/file.js">console.log('hello');</blaze-write> After text`;
    const result = removeBlazeTags(text);
    expect(result).toBe("Before text  After text");
  });

  it("should remove a single blaze-delete tag", () => {
    const text = `Before text <blaze-delete path="src/file.js"></blaze-delete> After text`;
    const result = removeBlazeTags(text);
    expect(result).toBe("Before text  After text");
  });

  it("should remove a single blaze-rename tag", () => {
    const text = `Before text <blaze-rename from="old.js" to="new.js"></blaze-rename> After text`;
    const result = removeBlazeTags(text);
    expect(result).toBe("Before text  After text");
  });

  it("should remove multiple different blaze tags", () => {
    const text = `Start <blaze-write path="file1.js">code here</blaze-write> middle <blaze-delete path="file2.js"></blaze-delete> end <blaze-rename from="old.js" to="new.js"></blaze-rename> finish`;
    const result = removeBlazeTags(text);
    expect(result).toBe("Start  middle  end  finish");
  });

  it("should remove blaze tags with multiline content", () => {
    const text = `Before
<blaze-write path="src/component.tsx" description="A React component">
import React from 'react';

const Component = () => {
  return <div>Hello World</div>;
};

export default Component;
</blaze-write>
After`;
    const result = removeBlazeTags(text);
    expect(result).toBe("Before\n\nAfter");
  });

  it("should handle blaze tags with complex attributes", () => {
    const text = `Text <blaze-write path="src/file.js" description="Complex component with quotes" version="1.0">const x = "hello world";</blaze-write> more text`;
    const result = removeBlazeTags(text);
    expect(result).toBe("Text  more text");
  });

  it("should remove blaze tags and trim whitespace", () => {
    const text = `  <blaze-write path="file.js">code</blaze-write>  `;
    const result = removeBlazeTags(text);
    expect(result).toBe("");
  });

  it("should handle nested content that looks like tags", () => {
    const text = `<blaze-write path="file.js">
const html = '<div>Hello</div>';
const component = <Component />;
</blaze-write>`;
    const result = removeBlazeTags(text);
    expect(result).toBe("");
  });

  it("should handle self-closing blaze tags", () => {
    const text = `Before <blaze-delete path="file.js" /> After`;
    const result = removeBlazeTags(text);
    expect(result).toBe('Before <blaze-delete path="file.js" /> After');
  });

  it("should handle malformed blaze tags gracefully", () => {
    const text = `Before <blaze-write path="file.js">unclosed tag After`;
    const result = removeBlazeTags(text);
    expect(result).toBe(
      'Before <blaze-write path="file.js">unclosed tag After',
    );
  });

  it("should handle blaze tags with special characters in content", () => {
    const text = `<blaze-write path="file.js">
const regex = /<div[^>]*>.*?</div>/g;
const special = "Special chars: @#$%^&*()[]{}|\\";
</blaze-write>`;
    const result = removeBlazeTags(text);
    expect(result).toBe("");
  });

  it("should handle multiple blaze tags of the same type", () => {
    const text = `<blaze-write path="file1.js">code1</blaze-write> between <blaze-write path="file2.js">code2</blaze-write>`;
    const result = removeBlazeTags(text);
    expect(result).toBe("between");
  });

  it("should handle blaze tags with custom tag names", () => {
    const text = `Before <blaze-custom-action param="value">content</blaze-custom-action> After`;
    const result = removeBlazeTags(text);
    expect(result).toBe("Before  After");
  });
});

describe("buildDiagnosticStatusTag", () => {
  it("should build a diagnostic status block with apply metadata", () => {
    const tag = buildDiagnosticStatusTag({
      rawResponse: "Generated update details",
      autoApplied: true,
      status: {
        updatedFiles: true,
        extraFiles: ["README.md"],
      },
    });

    expect(tag).toContain(`<blaze-status title="Diagnostic details">`);
    expect(tag).toContain("Auto-applied: yes");
    expect(tag).toContain("Updated files: yes");
    expect(tag).toContain("Extra files: README.md");
    expect(tag).toContain("Assistant raw output:");
    expect(tag).toContain("Generated update details");
  });

  it("should include error context when apply fails", () => {
    const tag = buildDiagnosticStatusTag({
      rawResponse: "Attempted patch",
      autoApplied: false,
      status: {
        updatedFiles: false,
        error: "Failed to create commit",
        extraFilesError: "Git permissions error",
      },
    });

    expect(tag).toContain("Auto-applied: no");
    expect(tag).toContain("Apply error: Failed to create commit");
    expect(tag).toContain("Extra files error: Git permissions error");
  });
});

describe("extractActionTagsForManualApproval", () => {
  it("keeps only actionable blaze tags for manual approval payload", () => {
    const payload = extractActionTagsForManualApproval(`
      Here is my plan:
      <blaze-chat-summary>Update landing hero</blaze-chat-summary>
      <blaze-write path="src/App.tsx">export default function App(){return <div/>}</blaze-write>
      <blaze-command type="rebuild"></blaze-command>
      Thanks!
    `);

    expect(payload).toContain("<blaze-chat-summary>Update landing hero");
    expect(payload).toContain('<blaze-write path="src/App.tsx">');
    expect(payload).toContain('<blaze-command type="rebuild">');
    expect(payload).not.toContain("Here is my plan");
    expect(payload).not.toContain("Thanks!");
  });

  it("returns empty string when there are no actionable blaze tags", () => {
    const payload = extractActionTagsForManualApproval(
      "No actionable tags in this response.",
    );

    expect(payload).toBe("");
  });
});

describe("sanitizeGeneratedSummary", () => {
  it("removes manual command recommendations from generated summary", () => {
    const sanitized = sanitizeGeneratedSummary(`
### Что изменилось
- ✅ Обновлен заголовок.
- 🔄 Изменения не применены автоматически — требуется ручной Rebuild.
- 🔁 Пожалуйста, нажмите "Rebuild", чтобы пересобрать приложение.
- ⚠️ Если не поможет, попробуйте Restart.
    `);

    expect(sanitized).toContain("### Что изменилось");
    expect(sanitized).toContain("✅ Обновлен заголовок.");
    expect(sanitized).not.toMatch(/rebuild/i);
    expect(sanitized).not.toMatch(/restart/i);
    expect(sanitized).not.toMatch(/нажмите/i);
  });

  it("strips blaze-command tags from generated summary", () => {
    const sanitized = sanitizeGeneratedSummary(`
### What changed
- Updated hero copy.
<blaze-command type="rebuild"></blaze-command>
    `);

    expect(sanitized).toContain("### What changed");
    expect(sanitized).toContain("Updated hero copy.");
    expect(sanitized).not.toContain("<blaze-command");
  });
});

describe("formatSelectedComponentLabel", () => {
  it("keeps file location for source-backed components", () => {
    const label = formatSelectedComponentLabel({
      id: "src/App.tsx:12:5",
      name: "HeroSection",
      relativePath: "src/App.tsx",
      lineNumber: 12,
      columnNumber: 5,
    });

    expect(label).toBe("HeroSection (src/App.tsx:12)");
  });

  it("returns compact label for DOM-only selections", () => {
    const label = formatSelectedComponentLabel({
      id: "__dom__/div-1/h3-1:1:1",
      name: "h3",
      relativePath: "__dom__/div-1/h3-1",
      lineNumber: 1,
      columnNumber: 1,
    });

    expect(label).toBe("h3 ...");
  });
});

describe("formatSelectedComponentPromptBlock", () => {
  it("omits snippet section for DOM-only selected components and includes DOM context", () => {
    const block = formatSelectedComponentPromptBlock({
      component: {
        id: "__dom__/div-1/h3-1:1:1",
        name: "h3",
        tagName: "h3",
        textPreview: "Быстрейший запуск",
        domPath: "div-1/section-2/h3-1",
        relativePath: "__dom__/div-1/h3-1",
        lineNumber: 1,
        columnNumber: 1,
      },
      index: 0,
      totalComponents: 3,
    });

    expect(block).toContain("1. Component: h3 ...");
    expect(block).toContain("Tag: <h3>");
    expect(block).toContain('Rendered text: "Быстрейший запуск"');
    expect(block).toContain("DOM path: div-1/section-2/h3-1");
    expect(block).not.toContain("Snippet:");
    expect(block).not.toContain("[component snippet not available]");
  });

  it("derives DOM tag/path hints from fallback component fields", () => {
    const block = formatSelectedComponentPromptBlock({
      component: {
        id: "__dom__/div-1/section-2/p-3:1:1",
        name: "p",
        relativePath: "__dom__/div-1/section-2/p-3",
        lineNumber: 1,
        columnNumber: 1,
      },
      index: 1,
      totalComponents: 3,
    });

    expect(block).toContain("2. Component: p ...");
    expect(block).toContain("Tag: <p>");
    expect(block).toContain("DOM path: div-1/section-2/p-3");
    expect(block).not.toContain("Snippet:");
  });

  it("includes snippet for source-backed selected components", () => {
    const block = formatSelectedComponentPromptBlock({
      component: {
        id: "src/App.tsx:12:5",
        name: "HeroSection",
        relativePath: "src/App.tsx",
        lineNumber: 12,
        columnNumber: 5,
      },
      index: 0,
      totalComponents: 1,
      snippet: "<h1>Hello</h1>",
    });

    expect(block).toContain("Component: HeroSection (src/App.tsx:12)");
    expect(block).toContain("Snippet:");
    expect(block).toContain("<h1>Hello</h1>");
  });
});

describe("hasUnclosedBlazeWrite", () => {
  it("should return false when there are no blaze-write tags", () => {
    const text = "This is just regular text without any blaze tags.";
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should return false when blaze-write tag is properly closed", () => {
    const text = `<blaze-write path="src/file.js">console.log('hello');</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should return true when blaze-write tag is not closed", () => {
    const text = `<blaze-write path="src/file.js">console.log('hello');`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(true);
  });

  it("should return false when blaze-write tag with attributes is properly closed", () => {
    const text = `<blaze-write path="src/file.js" description="A test file">console.log('hello');</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should return true when blaze-write tag with attributes is not closed", () => {
    const text = `<blaze-write path="src/file.js" description="A test file">console.log('hello');`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(true);
  });

  it("should return false when there are multiple closed blaze-write tags", () => {
    const text = `<blaze-write path="src/file1.js">code1</blaze-write>
    Some text in between
    <blaze-write path="src/file2.js">code2</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should return true when the last blaze-write tag is unclosed", () => {
    const text = `<blaze-write path="src/file1.js">code1</blaze-write>
    Some text in between
    <blaze-write path="src/file2.js">code2`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(true);
  });

  it("should return false when first tag is unclosed but last tag is closed", () => {
    const text = `<blaze-write path="src/file1.js">code1
    Some text in between
    <blaze-write path="src/file2.js">code2</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should handle multiline content correctly", () => {
    const text = `<blaze-write path="src/component.tsx" description="React component">
import React from 'react';

const Component = () => {
  return (
    <div>
      <h1>Hello World</h1>
    </div>
  );
};

export default Component;
</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should handle multiline unclosed content correctly", () => {
    const text = `<blaze-write path="src/component.tsx" description="React component">
import React from 'react';

const Component = () => {
  return (
    <div>
      <h1>Hello World</h1>
    </div>
  );
};

export default Component;`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(true);
  });

  it("should handle complex attributes correctly", () => {
    const text = `<blaze-write path="src/file.js" description="File with quotes and special chars" version="1.0" author="test">
const message = "Hello 'world'";
const regex = /<div[^>]*>/g;
</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should handle text before and after blaze-write tags", () => {
    const text = `Some text before the tag
<blaze-write path="src/file.js">console.log('hello');</blaze-write>
Some text after the tag`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should handle unclosed tag with text after", () => {
    const text = `Some text before the tag
<blaze-write path="src/file.js">console.log('hello');
Some text after the unclosed tag`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(true);
  });

  it("should handle empty blaze-write tags", () => {
    const text = `<blaze-write path="src/file.js"></blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should handle unclosed empty blaze-write tags", () => {
    const text = `<blaze-write path="src/file.js">`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(true);
  });

  it("should focus on the last opening tag when there are mixed states", () => {
    const text = `<blaze-write path="src/file1.js">completed content</blaze-write>
    <blaze-write path="src/file2.js">unclosed content
    <blaze-write path="src/file3.js">final content</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });

  it("should handle tags with special characters in attributes", () => {
    const text = `<blaze-write path="src/file-name_with.special@chars.js" description="File with special chars in path">content</blaze-write>`;
    const result = hasUnclosedBlazeWrite(text);
    expect(result).toBe(false);
  });
});
