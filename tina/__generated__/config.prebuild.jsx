// tina/config.js
import { defineConfig } from "tinacms";
var config_default = defineConfig({
  branch: "",
  clientId: null,
  token: null,
  contentApiUrlOverride: "/api/tina/backend",
  build: {
    outputFolder: "admin",
    publicFolder: "public"
  },
  media: {
    tina: {
      mediaRoot: "uploads",
      publicFolder: "public"
    }
  },
  schema: {
    collections: [
      {
        name: "blog",
        label: "Blog Posts",
        path: "src/content/blog",
        format: "md",
        ui: {
          filename: {
            readonly: false,
            slugify: (values) => {
              const date = values.pubDate ? new Date(values.pubDate) : /* @__PURE__ */ new Date();
              const yyyy = date.getFullYear();
              const mm = String(date.getMonth() + 1).padStart(2, "0");
              const slug = (values.title || "").toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
              return `${yyyy}/${mm}/${slug}`;
            }
          }
        },
        fields: [
          {
            type: "string",
            name: "title",
            label: "Title",
            isTitle: true,
            required: true
          },
          {
            type: "datetime",
            name: "pubDate",
            label: "Publication Date",
            required: true
          },
          {
            type: "string",
            name: "description",
            label: "Description / TLDR",
            ui: {
              component: "textarea",
              actions: [
                {
                  name: "generateSummary",
                  label: "Generate Summary with AI",
                  icon: "wand",
                  action: async (form, field) => {
                    const values = form.getState().values;
                    const bodyText = values.body || "";
                    if (!bodyText) {
                      alert("Please fill in the body text first so AI can generate a summary.");
                      return;
                    }
                    try {
                      const response = await fetch("/api/ai/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          prompt: `Summarize the following clinical or medical article text in 2-3 sentences:

${bodyText}`
                        })
                      });
                      if (!response.ok) throw new Error("AI request failed");
                      const data = await response.json();
                      form.change("description", data.result || "");
                    } catch (err) {
                      alert("Failed to generate summary: " + err.message);
                    }
                  }
                }
              ]
            },
            required: true
          },
          {
            type: "string",
            name: "author",
            label: "Author",
            required: true
          },
          {
            type: "string",
            name: "tag",
            label: "Specialty / Tag"
          },
          {
            type: "string",
            name: "type",
            label: "Article Type",
            options: [
              { value: "general", label: "Clinical Digest" },
              { value: "update", label: "Advances" },
              { value: "case", label: "Case Reports" },
              { value: "education", label: "Board Review" }
            ]
          },
          {
            type: "string",
            name: "subject",
            label: "Subject / Category"
          },
          {
            type: "string",
            name: "topic",
            label: "Topic"
          },
          {
            type: "string",
            name: "exams",
            label: "Exams (e.g. USMLE, FRCP)",
            list: true
          },
          {
            type: "rich-text",
            name: "body",
            label: "Body",
            isBody: true,
            ui: {
              actions: [
                {
                  name: "generateDraft",
                  label: "Generate Summary with AI",
                  icon: "wand",
                  action: async (form, field) => {
                    const values = form.getState().values;
                    const title = values.title || "";
                    if (!title) {
                      alert("Please fill in the title first so AI can generate content.");
                      return;
                    }
                    try {
                      const response = await fetch("/api/ai/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          prompt: `Write a medical/scientific research compilation draft for an article titled: "${title}". Make it informative, clear, and structured.`
                        })
                      });
                      if (!response.ok) throw new Error("AI request failed");
                      const data = await response.json();
                      form.change("body", {
                        type: "root",
                        children: [
                          {
                            type: "p",
                            children: [{ type: "text", text: data.result || "" }]
                          }
                        ]
                      });
                    } catch (err) {
                      alert("Failed to generate draft: " + err.message);
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  }
});
export {
  config_default as default
};
