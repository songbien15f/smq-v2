using System;
using System.Collections.Generic;
using System.Data.SQLite;
using System.IO;
using System.Text;

class DumpAll
{
    static string Esc(string s)
    {
        if (s == null) return "null";
        var b = new StringBuilder();
        b.Append('"');
        foreach (var ch in s)
        {
            switch (ch)
            {
                case '"': b.Append("\\\""); break;
                case '\\': b.Append("\\\\"); break;
                case '\n': b.Append("\\n"); break;
                case '\r': b.Append("\\r"); break;
                case '\t': b.Append("\\t"); break;
                default:
                    if (ch < 32) b.Append("\\u").Append(((int)ch).ToString("x4"));
                    else b.Append(ch);
                    break;
            }
        }
        b.Append('"');
        return b.ToString();
    }

    static void Main(string[] args)
    {
        string db = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "price.db");
        string outDir = args.Length > 0 ? args[0] : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "out");
        Directory.CreateDirectory(outDir);

        // The database password is read from the environment rather than written
        // here: this file is committed, and the password protects a licensed
        // price book that belongs to the client, not to this repository.
        string password = Environment.GetEnvironmentVariable("PRICE_DB_PASSWORD");
        if (string.IsNullOrEmpty(password))
        {
            Console.Error.WriteLine("PRICE_DB_PASSWORD is not set. See tools/price-dump/README.md.");
            Environment.Exit(2);
        }

        var csb = new SQLiteConnectionStringBuilder
        {
            DataSource = db,
            Password = password,
            Version = 3,
            FailIfMissing = true,
        };

        var summary = new List<string>();
        using (var c = new SQLiteConnection(csb.ConnectionString))
        {
            c.Open();
            var names = new List<KeyValuePair<string, string>>();
            using (var cmd = new SQLiteCommand("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name", c))
            using (var r = cmd.ExecuteReader())
            {
                while (r.Read()) names.Add(new KeyValuePair<string, string>(r.GetString(0), r.GetString(1)));
            }

            foreach (var t in names)
            {
                var rows = new List<string>();
                try
                {
                    using (var cmd = new SQLiteCommand("SELECT * FROM [" + t.Key + "]", c))
                    using (var r = cmd.ExecuteReader())
                    {
                        while (r.Read())
                        {
                            var fields = new List<string>();
                            for (int i = 0; i < r.FieldCount; i++)
                            {
                                object v = r.IsDBNull(i) ? null : r.GetValue(i);
                                string cell;
                                if (v == null) cell = "null";
                                else if (v is string) cell = Esc((string)v);
                                else if (v is byte[]) cell = Esc(Convert.ToBase64String((byte[])v));
                                else if (v is double) cell = ((double)v).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
                                else if (v is float) cell = ((float)v).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
                                else if (v is long || v is int || v is short || v is byte || v is bool) cell = v.ToString().ToLowerInvariant();
                                else cell = Esc(v.ToString());
                                fields.Add(Esc(r.GetName(i)) + ":" + cell);
                            }
                            rows.Add("{" + string.Join(",", fields.ToArray()) + "}");
                        }
                    }
                }
                catch (Exception e)
                {
                    summary.Add(t.Key + "\t" + t.Value + "\tERROR " + e.Message);
                    continue;
                }
                File.WriteAllText(Path.Combine(outDir, t.Key + ".json"), "[" + string.Join(",\n", rows.ToArray()) + "]");
                summary.Add(t.Key + "\t" + t.Value + "\t" + rows.Count);
            }
        }

        File.WriteAllLines(Path.Combine(outDir, "_summary.tsv"), summary.ToArray());
        Console.WriteLine("DONE " + summary.Count + " objects -> " + outDir);
    }
}
