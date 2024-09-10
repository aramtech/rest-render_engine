const path = (await import("path")).default;
const url = await import("url");
const cron_parser = (await import("cron-parser")).default;

const env = (await import("$/server/env.js")).default;

const app_path = env.app_path;
const pq = (await import(path.join(app_path, "server/database/helpers/promise_query.db.js"))).default;
const cmn = (await import(path.join(app_path, "server/utils/common/index.ts"))).default;

export default async function () {
    const cron_exp = cron_parser.parseExpression("0 0 0 * * */1");
    let yesterday = cron_exp.prev().toDate();
    if (yesterday.getDate() == new Date().getDate()) {
        yesterday = cron_exp.prev().toDate();
    }

    const mysql_yesterday_date = cmn.datetime.date_to_mysqlstring(yesterday, true);
    console.log(mysql_yesterday_date);
    const users = await pq(`
        select * from user where deleted = 0 and role in ('sr', 'mr')
    `);

    const report = {
        yesterday: yesterday,
        mysql_yesterday_date,
    };

    // check if the user have a bundle this week
    for (const user of users) {
        const user_this_weeks_bundle = (
            await pq(`
            select * from task_bundles as tb where date(now()) between tb.bundle_start_date and tb.bundle_end_date and deleted = 0 and user_id = '${user.user_id}'
        `)
        )[0];

        user.bundle = user_this_weeks_bundle;

        if (user.bundle) {
            user.bundle.tasks = await pq(`
                select * from tasks where deleted = 0 and bundle_id = '${user.bundle.bundle_id}' and date(task_designated_date) = '${mysql_yesterday_date}'
            `);
            user.bundle.tasks = user.bundle.tasks.map((task) => ({
                ...task,
                ...JSON.parse(Buffer.from(task.details_json || "", "base64").toString() || "null"),
                start_json: JSON.parse(Buffer.from(task.start_json || "", "base64").toString() || "null"),
                finish_json: JSON.parse(Buffer.from(task.finish_json || "", "base64").toString() || "null"),
            }));
        }
    }

    report.users = users;

    return report;
}
