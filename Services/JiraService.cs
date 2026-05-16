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

        var url = $"https://{domain}/rest/api/3/search"
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
