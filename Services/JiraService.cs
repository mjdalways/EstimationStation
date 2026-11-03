using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace EstimationStation.Services;

public class JiraService(IHttpClientFactory httpClientFactory)
{
    public async Task<List<JiraIssue>> FetchIssuesAsync(string domain, string email, string token, string jql, int maxResults = 50)
    {
        var client = httpClientFactory.CreateClient("jira");
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{email}:{token}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        // B9: Atlassian is deprecating GET /rest/api/3/search in favor of /search/jql (which
        // drops total-count/startAt-offset pagination for a nextPageToken cursor). We don't
        // paginate today (hard maxResults cap, single page) and only read the issues[] array,
        // so this is a same-shape response for our purposes — a straight endpoint swap.
        var url = $"https://{domain}/rest/api/3/search/jql"
                + $"?jql={Uri.EscapeDataString(jql)}"
                + $"&maxResults={maxResults}"
                + "&fields=summary,description,issuetype";

        var response = await client.GetAsync(url);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new InvalidOperationException(
                $"Jira API {(int)response.StatusCode}: {body[..Math.Min(body.Length, 300)]}");
        }

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var issues = new List<JiraIssue>();

        foreach (var item in doc.RootElement.GetProperty("issues").EnumerateArray())
        {
            var key = item.GetProperty("key").GetString() ?? "";
            var fields = item.GetProperty("fields");
            var summary = fields.GetProperty("summary").GetString() ?? "";
            var description = fields.TryGetProperty("description", out var descEl)
                              && descEl.ValueKind != JsonValueKind.Null
                ? ExtractAdfText(descEl) : null;

            var issueTypeName = fields.TryGetProperty("issuetype", out var issueTypeEl)
                                && issueTypeEl.TryGetProperty("name", out var typeNameEl)
                ? typeNameEl.GetString() : null;

            issues.Add(new JiraIssue
            {
                Key = key,
                Summary = summary,
                Description = string.IsNullOrWhiteSpace(description) ? null : description,
                Url = $"https://{domain}/browse/{key}",
                IssueType = string.IsNullOrWhiteSpace(issueTypeName) ? null : issueTypeName
            });
        }

        return issues;
    }

    public async Task WriteEstimateAsync(string domain, string email, string token,
        string jiraKey, double estimate, string fieldId)
    {
        var client = httpClientFactory.CreateClient("jira");
        var url = $"https://{domain}/rest/api/3/issue/{jiraKey}";
        var body = new Dictionary<string, object>
        {
            ["fields"] = new Dictionary<string, object> { [fieldId] = estimate }
        };
        var json = JsonSerializer.Serialize(body);
        var request = new HttpRequestMessage(HttpMethod.Put, url)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{email}:{token}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    // ------------------------------------------------------------------
    // F11/P4-R3 — sprint context for the retro board
    // ------------------------------------------------------------------

    /// <summary>
    /// Fetches a sprint's name/goal/dates plus its issues, for the retro's sprint context
    /// rail. Uses the Agile API (/rest/agile/1.0) rather than the platform API because only
    /// the former knows what a sprint is. The caller validates the domain through
    /// PokerHub.TryValidateJiraDomain first — the SSRF guard from cced825 applies unchanged.
    /// </summary>
    public async Task<JiraSprint> FetchSprintAsync(string domain, string email, string token,
        string sprintId, string? storyPointsField = null, int maxResults = 100)
    {
        var client = httpClientFactory.CreateClient("jira");
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{email}:{token}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var encodedId = Uri.EscapeDataString(sprintId);
        var sprint = new JiraSprint { Id = sprintId };

        var metaResponse = await client.GetAsync($"https://{domain}/rest/agile/1.0/sprint/{encodedId}");
        if (!metaResponse.IsSuccessStatusCode)
        {
            var body = await metaResponse.Content.ReadAsStringAsync();
            throw new InvalidOperationException(
                $"Jira API {(int)metaResponse.StatusCode}: {body[..Math.Min(body.Length, 300)]}");
        }
        using (var metaDoc = JsonDocument.Parse(await metaResponse.Content.ReadAsStringAsync()))
        {
            var root = metaDoc.RootElement;
            sprint.Name = Str(root, "name") ?? $"Sprint {sprintId}";
            sprint.Goal = Str(root, "goal") ?? "";
            sprint.State = Str(root, "state") ?? "";
            sprint.StartDate = Str(root, "startDate");
            sprint.EndDate = Str(root, "endDate");
        }

        // The story-point field is per-instance custom, so it is only requested when the
        // caller knows its id (the room already stores one for WriteEstimateAsync).
        var fields = "summary,status,issuetype,assignee,resolutiondate";
        if (!string.IsNullOrWhiteSpace(storyPointsField)) fields += "," + storyPointsField.Trim();

        var issuesUrl = $"https://{domain}/rest/agile/1.0/sprint/{encodedId}/issue"
                      + $"?maxResults={maxResults}&fields={Uri.EscapeDataString(fields)}";
        var issuesResponse = await client.GetAsync(issuesUrl);
        if (!issuesResponse.IsSuccessStatusCode)
        {
            var body = await issuesResponse.Content.ReadAsStringAsync();
            throw new InvalidOperationException(
                $"Jira API {(int)issuesResponse.StatusCode}: {body[..Math.Min(body.Length, 300)]}");
        }

        using var doc = JsonDocument.Parse(await issuesResponse.Content.ReadAsStringAsync());
        if (doc.RootElement.TryGetProperty("issues", out var issuesEl))
        {
            foreach (var item in issuesEl.EnumerateArray())
            {
                var key = Str(item, "key") ?? "";
                if (!item.TryGetProperty("fields", out var f)) continue;

                var statusName = f.TryGetProperty("status", out var st) ? Str(st, "name") : null;
                var statusCategory = f.TryGetProperty("status", out var st2)
                                     && st2.TryGetProperty("statusCategory", out var sc)
                    ? Str(sc, "key") : null;   // "new" | "indeterminate" | "done"

                double? points = null;
                if (!string.IsNullOrWhiteSpace(storyPointsField)
                    && f.TryGetProperty(storyPointsField.Trim(), out var spEl)
                    && spEl.ValueKind == JsonValueKind.Number)
                {
                    points = spEl.GetDouble();
                }

                sprint.Issues.Add(new JiraSprintIssue
                {
                    Key = key,
                    Summary = f.TryGetProperty("summary", out var sEl) ? sEl.GetString() ?? "" : "",
                    Status = statusName ?? "",
                    StatusCategory = statusCategory ?? "new",
                    IssueType = f.TryGetProperty("issuetype", out var itEl) ? Str(itEl, "name") ?? "" : "",
                    Assignee = f.TryGetProperty("assignee", out var asEl) && asEl.ValueKind != JsonValueKind.Null
                        ? Str(asEl, "displayName") ?? "" : "",
                    ResolvedAt = Str(f, "resolutiondate"),
                    StoryPoints = points,
                    Url = $"https://{domain}/browse/{key}"
                });
            }
        }

        return sprint;
    }

    /// <summary>
    /// F11/P4-R4 — creates a Jira task from a retro action. Mirrors WriteEstimateAsync's
    /// write path (same auth, same per-item success/failure reporting by the caller) and
    /// returns the new issue's key so the action can link back to it.
    /// </summary>
    public async Task<JiraIssue> CreateIssueAsync(string domain, string email, string token,
        string projectKey, string issueType, string summary, string? description)
    {
        var client = httpClientFactory.CreateClient("jira");
        var fields = new Dictionary<string, object>
        {
            ["project"] = new Dictionary<string, object> { ["key"] = projectKey },
            ["issuetype"] = new Dictionary<string, object> { ["name"] = issueType },
            ["summary"] = summary
        };
        if (!string.IsNullOrWhiteSpace(description))
        {
            // Jira Cloud's create endpoint takes Atlassian Document Format, not plain text.
            fields["description"] = new Dictionary<string, object>
            {
                ["type"] = "doc",
                ["version"] = 1,
                ["content"] = description.Replace("\r\n", "\n").Split('\n')
                    .Select(line => new Dictionary<string, object>
                    {
                        ["type"] = "paragraph",
                        ["content"] = string.IsNullOrEmpty(line)
                            ? new List<object>()
                            : new List<object>
                              {
                                  new Dictionary<string, object> { ["type"] = "text", ["text"] = line }
                              }
                    })
                    .Cast<object>().ToList()
            };
        }

        var json = JsonSerializer.Serialize(new Dictionary<string, object> { ["fields"] = fields });
        var request = new HttpRequestMessage(HttpMethod.Post, $"https://{domain}/rest/api/3/issue")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{email}:{token}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var response = await client.SendAsync(request);
        var responseBody = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Jira API {(int)response.StatusCode}: {responseBody[..Math.Min(responseBody.Length, 300)]}");
        }

        using var doc = JsonDocument.Parse(responseBody);
        var newKey = Str(doc.RootElement, "key") ?? "";
        return new JiraIssue
        {
            Key = newKey,
            Summary = summary,
            Url = $"https://{domain}/browse/{newKey}",
            IssueType = issueType
        };
    }

    // Jira omits optional fields entirely and sends JSON null for empty ones, so every read
    // of an optional string goes through this rather than repeating the two checks.
    private static string? Str(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string ExtractAdfText(JsonElement adf)
    {
        var sb = new StringBuilder();
        ExtractAdfNode(adf, sb);
        return sb.ToString().Trim();
    }

    private static void ExtractAdfNode(JsonElement node, StringBuilder sb)
    {
        if (node.TryGetProperty("type", out var typeEl))
        {
            var type = typeEl.GetString();
            if (type == "text")
            {
                if (node.TryGetProperty("text", out var textEl))
                    sb.Append(textEl.GetString());
                return;
            }
            if (type is "paragraph" or "heading" && sb.Length > 0)
                sb.Append('\n');
            if (type == "table") { sb.Append("[table]"); return; }
            if (type == "codeBlock") { sb.Append("[code]"); return; }
        }

        if (node.TryGetProperty("content", out var content))
            foreach (var child in content.EnumerateArray())
                ExtractAdfNode(child, sb);
    }
}

public class JiraIssue
{
    public string Key { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Url { get; set; } = string.Empty;
    public string? IssueType { get; set; }
}

// F11/P4-R3 — the retro's sprint context, cached onto RetroBoard.SprintContextJson so the
// whole room sees the same sprint without everyone needing Jira credentials of their own.
public class JiraSprint
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Goal { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? StartDate { get; set; }
    public string? EndDate { get; set; }
    public List<JiraSprintIssue> Issues { get; set; } = new();
}

public class JiraSprintIssue
{
    public string Key { get; set; } = string.Empty;
    public string Summary { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    // "new" | "indeterminate" | "done" — the language-independent bucket, so "committed vs
    // completed" works on a board whose statuses are named anything at all.
    public string StatusCategory { get; set; } = "new";
    public string IssueType { get; set; } = string.Empty;
    public string Assignee { get; set; } = string.Empty;
    public string? ResolvedAt { get; set; }
    public double? StoryPoints { get; set; }
    public string Url { get; set; } = string.Empty;
}
