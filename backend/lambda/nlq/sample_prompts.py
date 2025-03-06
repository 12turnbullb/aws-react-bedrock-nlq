sample_queries = """
Example SQL Queries:
1. Query: What was the total donation amount for the New Year Kickstart campaign?

    select sum(d.donation_amount) as total_donation_amount
    from sample_donations d 
    left join sample_campaigns c on d.campaign_id = c.campaign_id
    where lower(campaign_name) like 'new year kickstart%'
    group by c.campaign_id, c.campaign_name
     
   Expected Result:
   | total_donation_amount |
   |-----------------------|
   | 12425                 | 
   
   
"""
